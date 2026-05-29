import { loadState, saveState } from "../storage/localDb";
import { DEFAULT_SNIPPET_LANGUAGE } from "../constants";
import { base64ToText, generateId, normalizeTagName, textToBase64 } from "../utils";
import type {
  Attachment,
  ClipboardAttachmentDraft,
  CreateSnippetInput,
  PortableExportResult,
  PortableImportResult,
  SearchSnippetsInput,
  Snippet,
  Tag,
  UpdateSnippetInput
} from "../../types";
import { createNativeSnippetBridge, isTauriRuntime } from "../bridge/tauri";

export interface SnippetRepository {
  createSnippet(input: CreateSnippetInput): Promise<Snippet>;
  updateSnippet(id: string, input: UpdateSnippetInput): Promise<Snippet>;
  searchSnippets(input: SearchSnippetsInput): Promise<Snippet[]>;
  listTags(keyword: string): Promise<Tag[]>;
  attachImageFromClipboard(draft: ClipboardAttachmentDraft, snippetId: string): Promise<Snippet>;
  getSnippetById(id: string): Promise<Snippet | null>;
  exportPortableData(): Promise<PortableExportResult>;
  importPortableData(bytesBase64: string): Promise<PortableImportResult>;
}

interface BrowserExportBundle {
  format: "codestock-browser-json";
  version: 1;
  exportedAt: string;
  snippets: Snippet[];
  attachmentPayloads: Record<string, string>;
}

function dedupeTags(tagNames: string[]): Tag[] {
  const unique = new Map<string, Tag>();

  for (const name of tagNames.map((value) => value.trim()).filter(Boolean)) {
    const normalizedName = normalizeTagName(name);
    if (!unique.has(normalizedName)) {
      unique.set(normalizedName, {
        id: generateId("tag"),
        name,
        normalizedName
      });
    }
  }

  return Array.from(unique.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function upsertSnippet(nextSnippet: Snippet): Snippet[] {
  const state = loadState();
  const snippets = state.snippets.filter((snippet) => snippet.id !== nextSnippet.id);
  snippets.unshift(normalizeSnippet(nextSnippet));
  saveState({ snippets });
  return snippets;
}

function searchLocalSnippets(input: SearchSnippetsInput): Snippet[] {
  const { query, tags, sort } = input;
  const normalizedQuery = query.trim().toLowerCase();
  const selectedTags = tags.map(normalizeTagName);

  return loadState()
    .snippets
    .filter((snippet) => {
      const haystack = [
        snippet.title,
        ...snippet.codeBlocks.map((block) => `${block.language}\n${block.code}`),
        snippet.note,
        ...snippet.tags.map((tag) => tag.name)
      ]
        .join("\n")
        .toLowerCase();

      const matchesQuery = !normalizedQuery || haystack.includes(normalizedQuery);
      const matchesTags =
        selectedTags.length === 0 ||
        selectedTags.every((tag) => snippet.tags.some((item) => item.normalizedName === tag));

      return matchesQuery && matchesTags;
    })
    .sort((left, right) =>
      right[sort].localeCompare(left[sort])
    );
}

function ensureSnippet(id: string): Snippet {
  const snippet = loadState().snippets.find((item) => item.id === id);
  if (!snippet) {
    throw new Error("対象のスニペットが見つかりません。");
  }
  return snippet;
}

function buildAttachment(snippetId: string, draft: ClipboardAttachmentDraft): Attachment {
  return {
    id: generateId("attachment"),
    snippetId,
    filePath: `web-inline://${draft.fileName}`,
    mimeType: draft.mimeType,
    width: draft.width,
    height: draft.height,
    createdAt: new Date().toISOString()
  };
}

function persistAttachmentPayload(attachmentId: string, draft: ClipboardAttachmentDraft): void {
  window.localStorage.setItem(`codestock:attachment:${attachmentId}`, draft.bytesBase64);
}

function normalizeSnippet(snippet: Snippet): Snippet {
  const codeBlocks = normalizeCodeBlocks(snippet.codeBlocks, snippet.language, snippet.code);
  return {
    ...snippet,
    language: codeBlocks[0]?.language ?? snippet.language,
    code: codeBlocks[0]?.code ?? snippet.code,
    codeBlocks
  };
}

function normalizeCodeBlocks(
  blocks: Snippet["codeBlocks"] | undefined,
  fallbackLanguage: Snippet["language"],
  fallbackCode: string
) {
  if (blocks && blocks.length > 0) {
    return blocks.map((block, index) => ({
      id: block.id || generateId(`block${index + 1}`),
      language: block.language || fallbackLanguage || DEFAULT_SNIPPET_LANGUAGE,
      code: block.code ?? ""
    }));
  }

  return [
    {
      id: generateId("block"),
      language: fallbackLanguage || DEFAULT_SNIPPET_LANGUAGE,
      code: fallbackCode ?? ""
    }
  ];
}

export function readAttachmentDataUrl(attachmentId: string, mimeType: string): string | null {
  const base64 = window.localStorage.getItem(`codestock:attachment:${attachmentId}`);
  if (!base64) {
    return null;
  }
  return `data:${mimeType};base64,${base64}`;
}

export async function readAttachmentPreviewSrc(attachment: Attachment): Promise<string | null> {
  if (attachment.filePath.startsWith("web-inline://")) {
    return readAttachmentDataUrl(attachment.id, attachment.mimeType);
  }

  if (!isTauriRuntime()) {
    return null;
  }

  const bridge = createNativeSnippetBridge();
  const base64 = await bridge.readAttachmentBase64(attachment.filePath);
  return `data:${attachment.mimeType};base64,${base64}`;
}

function exportBrowserData(): PortableExportResult {
  const state = loadState();
  const attachmentPayloads: Record<string, string> = {};

  for (const snippet of state.snippets) {
    for (const attachment of snippet.attachments) {
      const payload = window.localStorage.getItem(`codestock:attachment:${attachment.id}`);
      if (payload) {
        attachmentPayloads[attachment.id] = payload;
      }
    }
  }

  const bundle: BrowserExportBundle = {
    format: "codestock-browser-json",
    version: 1,
    exportedAt: new Date().toISOString(),
    snippets: state.snippets,
    attachmentPayloads
  };
  const bytesBase64 = textToBase64(JSON.stringify(bundle, null, 2));

  return {
    fileName: `codestock-browser-export-${Date.now()}.json`,
    bytesBase64,
    mimeType: "application/json",
    snippetCount: state.snippets.length,
    attachmentCount: Object.keys(attachmentPayloads).length
  };
}

function importBrowserData(bytesBase64: string): PortableImportResult {
  const bundle = JSON.parse(base64ToText(bytesBase64)) as BrowserExportBundle;
  if (bundle.format !== "codestock-browser-json" || bundle.version !== 1) {
    throw new Error("This import file is supported by the desktop app only.");
  }

  const current = loadState().snippets;
  const imported = bundle.snippets.map(normalizeSnippet);
  const importedIds = new Set(imported.map((snippet) => snippet.id));
  saveState({
    snippets: [
      ...imported,
      ...current.filter((snippet) => !importedIds.has(snippet.id))
    ]
  });
  for (const [attachmentId, payload] of Object.entries(bundle.attachmentPayloads)) {
    window.localStorage.setItem(`codestock:attachment:${attachmentId}`, payload);
  }

  return {
    importedSnippets: bundle.snippets.length,
    importedAttachments: Object.keys(bundle.attachmentPayloads).length
  };
}

export function createSnippetRepository(): SnippetRepository {
  const nativeBridge = isTauriRuntime() ? createNativeSnippetBridge() : null;

  return {
    async createSnippet(input) {
      if (nativeBridge) {
        return normalizeSnippet(await nativeBridge.createSnippet(input));
      }

      const now = new Date().toISOString();
      const codeBlocks = normalizeCodeBlocks(input.codeBlocks, DEFAULT_SNIPPET_LANGUAGE, "");
      const snippet: Snippet = {
        id: generateId("snippet"),
        title: input.title.trim() || "Untitled Snippet",
        code: codeBlocks[0]?.code ?? "",
        language: codeBlocks[0]?.language ?? DEFAULT_SNIPPET_LANGUAGE,
        codeBlocks,
        note: input.note,
        tags: dedupeTags(input.tags),
        attachments: [],
        createdAt: now,
        updatedAt: now
      };
      upsertSnippet(snippet);
      return snippet;
    },

    async updateSnippet(id, input) {
      if (nativeBridge) {
        return normalizeSnippet(await nativeBridge.updateSnippet(id, input));
      }

      const current = ensureSnippet(id);
      const codeBlocks = normalizeCodeBlocks(input.codeBlocks, current.language, current.code);
      const nextSnippet: Snippet = {
        ...current,
        title: input.title.trim() || "Untitled Snippet",
        code: codeBlocks[0]?.code ?? "",
        language: codeBlocks[0]?.language ?? DEFAULT_SNIPPET_LANGUAGE,
        codeBlocks,
        note: input.note,
        tags: dedupeTags(input.tags),
        updatedAt: new Date().toISOString()
      };
      upsertSnippet(nextSnippet);
      return nextSnippet;
    },

    async searchSnippets(input) {
      if (nativeBridge) {
        return (await nativeBridge.searchSnippets(input)).map(normalizeSnippet);
      }
      return searchLocalSnippets(input).map(normalizeSnippet);
    },

    async listTags(keyword) {
      if (nativeBridge) {
        return nativeBridge.listTags(keyword);
      }

      const normalizedKeyword = normalizeTagName(keyword);
      const map = new Map<string, Tag>();

      for (const snippet of loadState().snippets) {
        for (const tag of snippet.tags) {
          if (!normalizedKeyword || tag.normalizedName.includes(normalizedKeyword)) {
            map.set(tag.normalizedName, tag);
          }
        }
      }

      return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    },

    async attachImageFromClipboard(draft, snippetId) {
      if (nativeBridge) {
        return normalizeSnippet(await nativeBridge.attachImageFromClipboard(draft, snippetId));
      }

      const current = ensureSnippet(snippetId);
      const attachment = buildAttachment(snippetId, draft);
      persistAttachmentPayload(attachment.id, draft);
      const nextSnippet: Snippet = {
        ...current,
        attachments: [attachment, ...current.attachments],
        updatedAt: new Date().toISOString()
      };
      upsertSnippet(nextSnippet);
      return nextSnippet;
    },

    async getSnippetById(id) {
      return loadState().snippets.find((snippet) => snippet.id === id) ?? null;
    },

    async exportPortableData() {
      if (nativeBridge) {
        return nativeBridge.exportPortableData();
      }
      return exportBrowserData();
    },

    async importPortableData(bytesBase64) {
      if (nativeBridge) {
        return nativeBridge.importPortableData(bytesBase64);
      }
      return importBrowserData(bytesBase64);
    }
  };
}
