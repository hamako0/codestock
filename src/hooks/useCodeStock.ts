import { useEffect, useMemo, useState } from "react";
import { createSnippetRepository } from "../lib/repositories/snippetRepository";
import { normalizeTagName } from "../lib/utils";
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

  async function reload(
    nextQuery = query,
    nextTags = selectedTags,
    nextSort = sort,
    nextSelectedSnippetId = selectedSnippetId
  ) {
    const [foundSnippets, foundTags] = await Promise.all([
      repository.searchSnippets({ query: nextQuery, tags: nextTags, sort: nextSort }),
      repository.listTags("")
    ]);

    setSnippets(foundSnippets);
    setAvailableTags(foundTags);

    if (
      nextSelectedSnippetId &&
      !foundSnippets.some((snippet) => snippet.id === nextSelectedSnippetId)
    ) {
      setSelectedSnippetId(null);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function createSnippet(input: CreateSnippetInput) {
    const created = await repository.createSnippet(input);
    await reload(query, selectedTags, sort, created.id);
    setSelectedSnippetId(created.id);
    return created;
  }

  async function updateSnippet(id: string, input: UpdateSnippetInput) {
    await repository.updateSnippet(id, input);
    await reload();
  }

  async function deleteSnippet(id: string) {
    await repository.deleteSnippet(id);
    const foundTags = await repository.listTags("");
    const remainingTags = new Set(foundTags.map((tag) => normalizeTagName(tag.name)));
    const nextTags = selectedTags.filter((tag) => remainingTags.has(normalizeTagName(tag)));

    setQuery("");
    setSelectedTags(nextTags);
    setSelectedSnippetId(null);
    setAvailableTags(foundTags);
    setSnippets(await repository.searchSnippets({ query: "", tags: nextTags, sort }));
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
    deleteSnippet,
    attachImageFromClipboard,
    exportPortableData,
    importPortableData
  };
}
