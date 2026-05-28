import { useEffect, useMemo, useState } from "react";
import { createSnippetRepository } from "../lib/repositories/snippetRepository";
import type {
  ClipboardAttachmentDraft,
  CreateSnippetInput,
  PortableExportResult,
  PortableImportResult,
  Snippet,
  SnippetSort,
  Tag,
  UpdateSnippetInput
} from "../types";

export function useCodeStock() {
  const repository = useMemo(() => createSnippetRepository(), []);
  const [query, setQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [sort, setSort] = useState<SnippetSort>("updatedAt");
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [selectedSnippetId, setSelectedSnippetId] = useState<string | null>(null);

  async function reload(nextQuery = query, nextTags = selectedTags, nextSort = sort) {
    const [foundSnippets, foundTags] = await Promise.all([
      repository.searchSnippets({ query: nextQuery, tags: nextTags, sort: nextSort }),
      repository.listTags("")
    ]);

    setSnippets(foundSnippets);
    setAvailableTags(foundTags);

    if (!selectedSnippetId && foundSnippets[0]) {
      setSelectedSnippetId(foundSnippets[0].id);
    } else if (
      selectedSnippetId &&
      !foundSnippets.some((snippet) => snippet.id === selectedSnippetId)
    ) {
      setSelectedSnippetId(foundSnippets[0]?.id ?? null);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function createSnippet(input: CreateSnippetInput) {
    const created = await repository.createSnippet(input);
    setSelectedSnippetId(created.id);
    await reload();
    return created;
  }

  async function updateSnippet(id: string, input: UpdateSnippetInput) {
    await repository.updateSnippet(id, input);
    await reload();
  }

  async function attachImageFromClipboard(draft: ClipboardAttachmentDraft, snippetId: string) {
    const snippet = await repository.attachImageFromClipboard(draft, snippetId);
    await reload();
    return snippet;
  }

  async function refreshTags(keyword: string) {
    setAvailableTags(await repository.listTags(keyword));
  }

  async function exportPortableData(): Promise<PortableExportResult> {
    return repository.exportPortableData();
  }

  async function importPortableData(bytesBase64: string): Promise<PortableImportResult> {
    const result = await repository.importPortableData(bytesBase64);
    setQuery("");
    setSelectedTags([]);
    setSelectedSnippetId(null);
    await reload("", [], sort);
    return result;
  }

  const selectedSnippet = snippets.find((snippet) => snippet.id === selectedSnippetId) ?? null;

  return {
    query,
    setQuery,
    selectedTags,
    setSelectedTags,
    sort,
    setSort,
    snippets,
    selectedSnippet,
    selectedSnippetId,
    setSelectedSnippetId,
    beginNewSnippet() {
      setSelectedSnippetId(null);
    },
    availableTags,
    refreshTags,
    reload,
    createSnippet,
    updateSnippet,
    attachImageFromClipboard,
    exportPortableData,
    importPortableData
  };
}
