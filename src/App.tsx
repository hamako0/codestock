import { useEffect, useState } from "react";
import { DataPortability } from "./components/DataPortability";
import { SnippetComposer } from "./components/SnippetComposer";
import { SnippetDetail } from "./components/SnippetDetail";
import { SnippetList } from "./components/SnippetList";
import { useCodeStock } from "./hooks/useCodeStock";
import type { CreateSnippetInput } from "./types";

export function App() {
  const stock = useCodeStock();
  const [showDraftComposer, setShowDraftComposer] = useState(false);
  const hasActiveSearch = stock.query.trim().length > 0 || stock.selectedTags.length > 0;
  const hasSelectedSnippet = Boolean(stock.selectedSnippet);
  const showDetail = hasSelectedSnippet || showDraftComposer;

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void stock.reload(stock.query, stock.selectedTags, stock.sort);
    }, 120);

    return () => window.clearTimeout(timeout);
  }, [stock.query, stock.selectedTags, stock.sort]);

  function handleSelectSnippet(id: string) {
    setShowDraftComposer(false);
    stock.setSelectedSnippetId(id);
  }

  function handleBackToResults() {
    setShowDraftComposer(false);
    stock.setSelectedSnippetId(null);
  }

  function handleBeginNewSnippet() {
    stock.beginNewSnippet();
    setShowDraftComposer(true);
  }

  async function handleCreateSnippet(input: CreateSnippetInput) {
    const created = await stock.createSnippet(input);
    setShowDraftComposer(false);
    return created;
  }

  async function handleDeleteSnippet(id: string) {
    await stock.deleteSnippet(id);
    setShowDraftComposer(false);
  }

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

      <section className={getWorkspaceClassName(hasActiveSearch, showDetail)}>
        <SnippetList
          query={stock.query}
          selectedTags={stock.selectedTags}
          sort={stock.sort}
          snippets={stock.snippets}
          availableTags={stock.availableTags}
          showResults={hasActiveSearch && !showDetail}
          onQueryChange={stock.setQuery}
          onToggleTag={(tag) => {
            stock.setSelectedTags(
              stock.selectedTags.includes(tag)
                ? stock.selectedTags.filter((value) => value !== tag)
                : [...stock.selectedTags, tag]
            );
          }}
          onSortChange={stock.setSort}
          onSelectSnippet={handleSelectSnippet}
          onBeginNewSnippet={handleBeginNewSnippet}
        />

        {showDetail && (
          <div className={hasSelectedSnippet ? "selectedWorkspace" : "selectedWorkspace draftWorkspace"}>
            {stock.selectedSnippet ? (
              <SnippetDetail
                snippet={stock.selectedSnippet}
                onBack={handleBackToResults}
                onDelete={handleDeleteSnippet}
              />
            ) : (
              <section className="panel detailPanel">
                <div className="panelHeader">
                  <div>
                    <p className="eyebrow">Capture</p>
                    <h2>New Draft</h2>
                  </div>
                  <button className="ghostButton" onClick={handleBackToResults}>
                    Back to results
                  </button>
                </div>
              </section>
            )}

            <SnippetComposer
              availableTags={stock.availableTags}
              selectedSnippet={stock.selectedSnippet}
              onBeginNewSnippet={handleBeginNewSnippet}
              onCreateSnippet={handleCreateSnippet}
              onUpdateSnippet={stock.updateSnippet}
              onAttachImageFromClipboard={stock.attachImageFromClipboard}
              onRefreshTags={stock.refreshTags}
            />
          </div>
        )}
      </section>
    </main>
  );
}

function getWorkspaceClassName(hasActiveSearch: boolean, showDetail: boolean): string {
  if (showDetail) {
    return "workspaceFlow detailMode";
  }

  if (hasActiveSearch) {
    return "workspaceFlow resultsMode";
  }

  return "workspaceFlow initialMode";
}
