import { useEffect, useState } from "react";
import { SnippetNotePreview } from "./SnippetNotePreview";
import type { Snippet, SnippetCodeBlock } from "../types";

interface SnippetDetailProps {
  snippet: Snippet;
  onBack(): void;
  onDelete(id: string): Promise<void>;
}

export function SnippetDetail({ snippet, onBack, onDelete }: SnippetDetailProps) {
  const [toastMessage, setToastMessage] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!toastMessage) {
      return;
    }

    const timer = window.setTimeout(() => {
      setToastMessage("");
    }, 1800);

    return () => window.clearTimeout(timer);
  }, [toastMessage]);

  async function handleCopyBlock(block: SnippetCodeBlock) {
    try {
      await navigator.clipboard.writeText(block.code);
      setToastMessage(`${snippet.title}: ${block.language} copied.`);
    } catch {
      setToastMessage(`${snippet.title}: copy failed.`);
    }
  }

  async function handleDelete() {
    const confirmed = window.confirm(`Delete "${snippet.title}"?`);
    if (!confirmed) {
      return;
    }

    setIsDeleting(true);
    try {
      await onDelete(snippet.id);
    } catch {
      setToastMessage(`${snippet.title}: delete failed.`);
      setIsDeleting(false);
    }
  }

  return (
    <section className="panel detailPanel">
      {toastMessage && <div className="copyToast">{toastMessage}</div>}

      <div className="panelHeader">
        <div>
          <p className="eyebrow">Selected</p>
          <h2>{snippet.title}</h2>
        </div>
        <div className="actionRow">
          <button className="dangerButton" onClick={() => void handleDelete()} disabled={isDeleting}>
            {isDeleting ? "Deleting..." : "Delete"}
          </button>
          <button className="ghostButton" onClick={onBack}>
            Back to results
          </button>
        </div>
      </div>

      <div className="chipRow">
        {snippet.tags.map((tag) => (
          <span key={tag.id} className="chip staticChip">
            #{tag.name}
          </span>
        ))}
      </div>

      <SnippetNotePreview snippet={snippet} variant="detail" />

      <div className="copyActionGrid">
        {snippet.codeBlocks.map((block) => (
          <button
            key={block.id}
            className="copyButton"
            onClick={() => void handleCopyBlock(block)}
            aria-label={`Copy ${snippet.title} ${block.language}`}
            title={`Copy ${block.language}`}
          >
            Copy {block.language}
          </button>
        ))}
      </div>
    </section>
  );
}
