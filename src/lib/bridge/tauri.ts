import type {
  ClipboardAttachmentDraft,
  CreateSnippetInput,
  SearchSnippetsInput,
  Snippet,
  Tag,
  UpdateSnippetInput
} from "../../types";

declare global {
  interface Window {
    __TAURI__?: {
      core?: {
        invoke<T>(command: string, payload?: Record<string, unknown>): Promise<T>;
      };
    };
  }
}

function getInvoke() {
  return window.__TAURI__?.core?.invoke;
}

export function isTauriRuntime(): boolean {
  return typeof getInvoke() === "function";
}

export async function invokeIfAvailable<T>(
  command: string,
  payload?: Record<string, unknown>
): Promise<T | null> {
  const invoke = getInvoke();
  if (!invoke) {
    return null;
  }

  return invoke<T>(command, payload);
}

export interface NativeSnippetBridge {
  createSnippet(input: CreateSnippetInput): Promise<Snippet>;
  updateSnippet(id: string, input: UpdateSnippetInput): Promise<Snippet>;
  searchSnippets(input: SearchSnippetsInput): Promise<Snippet[]>;
  listTags(keyword: string): Promise<Tag[]>;
  attachImageFromClipboard(draft: ClipboardAttachmentDraft, snippetId: string): Promise<Snippet>;
  readAttachmentBase64(filePath: string): Promise<string>;
}

export function createNativeSnippetBridge(): NativeSnippetBridge {
  return {
    async createSnippet(input) {
      const snippet = await invokeIfAvailable<Snippet>("create_snippet", { input });
      if (!snippet) {
        throw new Error("Tauri bridge unavailable");
      }
      return snippet;
    },
    async updateSnippet(id, input) {
      const snippet = await invokeIfAvailable<Snippet>("update_snippet", { id, input });
      if (!snippet) {
        throw new Error("Tauri bridge unavailable");
      }
      return snippet;
    },
    async searchSnippets(input) {
      const snippets = await invokeIfAvailable<Snippet[]>("search_snippets", { input });
      if (!snippets) {
        throw new Error("Tauri bridge unavailable");
      }
      return snippets;
    },
    async listTags(keyword) {
      const tags = await invokeIfAvailable<Tag[]>("list_tags", { keyword });
      if (!tags) {
        throw new Error("Tauri bridge unavailable");
      }
      return tags;
    },
    async attachImageFromClipboard(draft, snippetId) {
      const snippet = await invokeIfAvailable<Snippet>("attach_image_from_clipboard", {
        draft,
        snippetId
      });
      if (!snippet) {
        throw new Error("Tauri bridge unavailable");
      }
      return snippet;
    },
    async readAttachmentBase64(filePath) {
      const base64 = await invokeIfAvailable<string>("read_attachment_base64", { filePath });
      if (!base64) {
        throw new Error("Tauri bridge unavailable");
      }
      return base64;
    }
  };
}
