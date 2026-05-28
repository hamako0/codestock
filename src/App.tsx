import { useEffect } from "react";
import { DataPortability } from "./components/DataPortability";
import { SnippetComposer } from "./components/SnippetComposer";
import { SnippetList } from "./components/SnippetList";
import { SnippetPreview } from "./components/SnippetPreview";
import { useCodeStock } from "./hooks/useCodeStock";

export function App() {
  const stock = useCodeStock();

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void stock.reload(stock.query, stock.selectedTags, stock.sort);
    }, 120);

    return () => window.clearTimeout(timeout);
  }, [stock.query, stock.selectedTags, stock.sort]);

  return (
    <main className="appShell">
      <section className="hero">
        <div>
          <p className="eyebrow">CodeStock v1</p>
          <h1>Fast local code capture for people who are done waiting on Notion.</h1>
          <p className="heroCopy">
            Tag-first search, one-screen capture, and clipboard image paste are wired into the app
            shape from the start.
          </p>
        </div>
        <div className="heroSide">
          <div className="heroMetrics">
            <div>
              <strong>{stock.snippets.length}</strong>
              <span>Snippets</span>
            </div>
            <div>
              <strong>{stock.availableTags.length}</strong>
              <span>Tags</span>
            </div>
            <div>
              <strong>{stock.selectedSnippet?.attachments.length ?? 0}</strong>
              <span>Images</span>
            </div>
          </div>
          <DataPortability
            onExportData={stock.exportPortableData}
            onImportData={stock.importPortableData}
          />
        </div>
      </section>

      <section className="workspaceGrid">
        <SnippetComposer
          availableTags={stock.availableTags}
          selectedSnippet={stock.selectedSnippet}
          onBeginNewSnippet={stock.beginNewSnippet}
          onCreateSnippet={stock.createSnippet}
          onUpdateSnippet={stock.updateSnippet}
          onAttachImageFromClipboard={stock.attachImageFromClipboard}
          onRefreshTags={stock.refreshTags}
        />

        <SnippetList
          query={stock.query}
          selectedTags={stock.selectedTags}
          sort={stock.sort}
          snippets={stock.snippets}
          availableTags={stock.availableTags}
          selectedSnippetId={stock.selectedSnippetId}
          onQueryChange={stock.setQuery}
          onToggleTag={(tag) => {
            stock.setSelectedTags(
              stock.selectedTags.includes(tag)
                ? stock.selectedTags.filter((value) => value !== tag)
                : [...stock.selectedTags, tag]
            );
          }}
          onSortChange={stock.setSort}
          onSelectSnippet={stock.setSelectedSnippetId}
        />

        <SnippetPreview snippet={stock.selectedSnippet} />
      </section>
    </main>
  );
}
