import { SnippetNotePreview } from "./SnippetNotePreview";
import type { Snippet, SnippetSort, Tag } from "../types";

interface SnippetListProps {
  query: string;
  selectedTags: string[];
  sort: SnippetSort;
  snippets: Snippet[];
  availableTags: Tag[];
  showResults: boolean;
  onQueryChange(value: string): void;
  onToggleTag(tag: string): void;
  onSortChange(value: SnippetSort): void;
  onSelectSnippet(id: string): void;
  onBeginNewSnippet(): void;
}

export function SnippetList({
  query,
  selectedTags,
  sort,
  snippets,
  availableTags,
  showResults,
  onQueryChange,
  onToggleTag,
  onSortChange,
  onSelectSnippet,
  onBeginNewSnippet
}: SnippetListProps) {
  return (
    <section className="panel listPanel">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">Search</p>
          <h2>Re-discover snippets</h2>
        </div>
        <div className="actionRow">
          <button className="primaryButton" onClick={onBeginNewSnippet}>
            New Snippet
          </button>
          <select value={sort} onChange={(event) => onSortChange(event.target.value as SnippetSort)}>
            <option value="updatedAt">Recently updated</option>
            <option value="createdAt">Recently created</option>
          </select>
        </div>
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

      {showResults && (
        <div className="candidateGrid">
          {snippets.map((snippet) => (
            <button key={snippet.id} className="snippetCard" onClick={() => onSelectSnippet(snippet.id)}>
              <div className="snippetCardTop">
                <strong>{snippet.title}</strong>
              </div>
              <SnippetNotePreview snippet={snippet} variant="candidate" />
              <div className="chipRow candidateTags">
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
      )}
    </section>
  );
}
