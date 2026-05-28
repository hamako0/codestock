import { useEffect, useState } from "react";
import type { Snippet, SnippetSort, Tag } from "../types";

interface SnippetListProps {
  query: string;
  selectedTags: string[];
  sort: SnippetSort;
  snippets: Snippet[];
  availableTags: Tag[];
  selectedSnippetId: string | null;
  onQueryChange(value: string): void;
  onToggleTag(tag: string): void;
  onSortChange(value: SnippetSort): void;
  onSelectSnippet(id: string): void;
}

export function SnippetList({
  query,
  selectedTags,
  sort,
  snippets,
  availableTags,
  selectedSnippetId,
  onQueryChange,
  onToggleTag,
  onSortChange,
  onSelectSnippet
}: SnippetListProps) {
  const [toastMessage, setToastMessage] = useState("");

  useEffect(() => {
    if (!toastMessage) {
      return;
    }

    const timer = window.setTimeout(() => {
      setToastMessage("");
    }, 1800);

    return () => window.clearTimeout(timer);
  }, [toastMessage]);

  async function handleCopyBlock(snippet: Snippet, language: string, code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setToastMessage(`${snippet.title}: ${language} をコピーしました`);
    } catch {
      setToastMessage(`${snippet.title}: コピーに失敗しました`);
    }
  }

  return (
    <section className="panel listPanel">
      {toastMessage && <div className="copyToast">{toastMessage}</div>}
      <div className="panelHeader">
        <div>
          <p className="eyebrow">Search</p>
          <h2>Re-discover snippets</h2>
        </div>
        <select value={sort} onChange={(event) => onSortChange(event.target.value as SnippetSort)}>
          <option value="updatedAt">Recently updated</option>
          <option value="createdAt">Recently created</option>
        </select>
      </div>

      <label className="field">
        <span>Quick search</span>
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="title, code, notes, tags"
        />
      </label>

      <div className="chipRow">
        {availableTags.slice(0, 16).map((tag) => {
          const active = selectedTags.includes(tag.name);
          return (
            <button
              key={tag.id}
              className={active ? "chip chipActive" : "chip"}
              onClick={() => onToggleTag(tag.name)}
            >
              #{tag.name}
            </button>
          );
        })}
      </div>

      <div className="snippetCards">
        {snippets.map((snippet) => (
          <button
            key={snippet.id}
            className={selectedSnippetId === snippet.id ? "snippetCard activeCard" : "snippetCard"}
            onClick={() => onSelectSnippet(snippet.id)}
          >
            <div className="snippetCardTop">
              <strong>{snippet.title}</strong>
              <span>{formatLanguages(snippet)}</span>
            </div>
            <p>{snippet.note || snippet.codeBlocks.map((block) => block.code).join("\n\n").slice(0, 100)}</p>
            <div className="snippetCardActions">
              {snippet.codeBlocks.map((block) => (
                <button
                  key={block.id}
                  className="copyButton"
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleCopyBlock(snippet, block.language, block.code);
                  }}
                  aria-label={`${snippet.title} の ${block.language} をコピー`}
                  title={`${block.language} をコピー`}
                >
                  Copy {block.language}
                </button>
              ))}
            </div>
            <div className="chipRow">
              {snippet.tags.map((tag) => (
                <span key={tag.id} className="chip staticChip">
                  #{tag.name}
                </span>
              ))}
            </div>
          </button>
        ))}

        {snippets.length === 0 && (
          <div className="emptyState">
            <strong>No snippets found.</strong>
            <p>Adjust search words or clear tag filters.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function formatLanguages(snippet: Snippet): string {
  const labels = Array.from(new Set(snippet.codeBlocks.map((block) => block.language)));
  return labels.join(" + ");
}
