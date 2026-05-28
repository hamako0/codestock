import { DEFAULT_SNIPPET_LANGUAGE } from "../constants";
import type { Snippet, SnippetCodeBlock } from "../../types";

const STORAGE_KEY = "codestock:v1";

export interface PersistedState {
  snippets: Snippet[];
}

export function loadState(): PersistedState {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return { snippets: [] };
  }

  try {
    const parsed = JSON.parse(raw) as PersistedState;
    return {
      snippets: parsed.snippets.map(normalizeSnippet)
    };
  } catch {
    return { snippets: [] };
  }
}

export function saveState(state: PersistedState): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function normalizeSnippet(snippet: Snippet): Snippet {
  const codeBlocks = normalizeCodeBlocks(snippet.codeBlocks, snippet.language, snippet.code);
  return {
    ...snippet,
    language: codeBlocks[0]?.language ?? snippet.language ?? DEFAULT_SNIPPET_LANGUAGE,
    code: codeBlocks[0]?.code ?? snippet.code ?? "",
    codeBlocks
  };
}

function normalizeCodeBlocks(
  codeBlocks: SnippetCodeBlock[] | undefined,
  fallbackLanguage: Snippet["language"],
  fallbackCode: string
): SnippetCodeBlock[] {
  if (Array.isArray(codeBlocks) && codeBlocks.length > 0) {
    return codeBlocks.map((block, index) => ({
      id: block.id || `block-${index + 1}`,
      language: block.language || fallbackLanguage || DEFAULT_SNIPPET_LANGUAGE,
      code: block.code ?? ""
    }));
  }

  return [
    {
      id: "block-1",
      language: fallbackLanguage || DEFAULT_SNIPPET_LANGUAGE,
      code: fallbackCode ?? ""
    }
  ];
}
