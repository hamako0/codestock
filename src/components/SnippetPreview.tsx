import { useEffect, useState } from "react";
import { readAttachmentPreviewSrc } from "../lib/repositories/snippetRepository";
import type { Snippet } from "../types";

const NOTE_IMAGE_TOKEN_PATTERN = /\[image:([^\]]+)\]/g;

interface SnippetPreviewProps {
  snippet: Snippet | null;
}

export function SnippetPreview({ snippet }: SnippetPreviewProps) {
  const [attachmentSources, setAttachmentSources] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;

    if (!snippet || snippet.attachments.length === 0) {
      setAttachmentSources({});
      return () => {
        active = false;
      };
    }

    void Promise.all(
      snippet.attachments.map(async (attachment) => {
        const src = await readAttachmentPreviewSrc(attachment);
        return [attachment.id, src] as const;
      })
    )
      .then((entries) => {
        if (!active) {
          return;
        }

        setAttachmentSources(
          entries.reduce<Record<string, string>>((accumulator, [id, src]) => {
            if (src) {
              accumulator[id] = src;
            }
            return accumulator;
          }, {})
        );
      })
      .catch(() => {
        if (active) {
          setAttachmentSources({});
        }
      });

    return () => {
      active = false;
    };
  }, [snippet]);

  if (!snippet) {
    return (
      <section className="panel previewPanel">
        <div className="emptyState">
          <strong>No snippet selected.</strong>
          <p>Create one or select a card from the search panel.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="panel previewPanel">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">Preview</p>
          <h2>{snippet.title}</h2>
        </div>
        <span className="metaStamp">{formatLanguages(snippet)}</span>
      </div>

      <div className="chipRow">
        {snippet.tags.map((tag) => (
          <span key={tag.id} className="chip staticChip">
            #{tag.name}
          </span>
        ))}
      </div>

      {snippet.note && <div className="previewNote">{renderNote(snippet.note, attachmentSources)}</div>}

      <div className="previewBlocks">
        {snippet.codeBlocks.map((block, index) => (
          <div key={block.id} className="previewBlockCard">
            <div className="previewBlockHeader">
              <span className="metaStamp">
                {block.language}
                {snippet.codeBlocks.length > 1 ? ` / Block ${index + 1}` : ""}
              </span>
            </div>
            <pre className="previewCode">
              <code>{block.code}</code>
            </pre>
          </div>
        ))}
      </div>

      {snippet.attachments.length > 0 && (
        <div className="attachmentGrid">
          {snippet.attachments.map((attachment) => {
            const src = attachmentSources[attachment.id];
            return src ? (
              <figure key={attachment.id} className="attachmentCard">
                <img src={src} alt="Attached clipboard capture" />
                <figcaption>
                  {attachment.width} x {attachment.height}
                </figcaption>
              </figure>
            ) : null;
          })}
        </div>
      )}
    </section>
  );
}

function formatLanguages(snippet: Snippet): string {
  return Array.from(new Set(snippet.codeBlocks.map((block) => block.language))).join(" + ");
}

function renderNote(note: string, attachmentSources: Record<string, string>) {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;

  for (const match of note.matchAll(NOTE_IMAGE_TOKEN_PATTERN)) {
    const matchText = match[0];
    const attachmentId = match[1];
    const index = match.index ?? 0;
    const text = note.slice(lastIndex, index);
    if (text) {
      parts.push(
        <p key={`text-${index}`} className="previewNoteText">
          {text}
        </p>
      );
    }

    const src = attachmentSources[attachmentId];
    parts.push(
      src ? (
        <img
          key={`image-${attachmentId}`}
          className="noteImage"
          src={src}
          alt="Embedded note attachment"
        />
      ) : (
        <p key={`missing-${attachmentId}`} className="previewNoteToken">
          {matchText}
        </p>
      )
    );
    lastIndex = index + matchText.length;
  }

  const tail = note.slice(lastIndex);
  if (tail) {
    parts.push(
      <p key={`text-tail-${lastIndex}`} className="previewNoteText">
        {tail}
      </p>
    );
  }

  if (parts.length === 0) {
    return <p className="previewNoteText">{note}</p>;
  }

  return parts;
}
