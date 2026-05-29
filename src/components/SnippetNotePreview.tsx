import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { readAttachmentPreviewSrc } from "../lib/repositories/snippetRepository";
import type { Attachment, Snippet } from "../types";

const NOTE_IMAGE_TOKEN_PATTERN = /\[image:([^\]]+)\]/g;

interface SnippetNotePreviewProps {
  snippet: Snippet;
  variant: "candidate" | "detail";
}

export function SnippetNotePreview({ snippet, variant }: SnippetNotePreviewProps) {
  const [attachmentSources, setAttachmentSources] = useState<Record<string, string>>({});
  const referencedAttachmentIds = useMemo(() => extractReferencedAttachmentIds(snippet.note), [
    snippet.note
  ]);
  const extraAttachments = snippet.attachments.filter(
    (attachment) => !referencedAttachmentIds.has(attachment.id) && attachmentSources[attachment.id]
  );

  useEffect(() => {
    let active = true;

    if (snippet.attachments.length === 0) {
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

  const noteParts = renderNote(snippet.note, attachmentSources, variant);
  const hasVisibleContent = noteParts.length > 0 || extraAttachments.length > 0;

  return (
    <div className={`snippetVisualNote ${variant}VisualNote`}>
      {noteParts}
      {extraAttachments.length > 0 && (
        <AttachmentGrid attachments={extraAttachments} sources={attachmentSources} variant={variant} />
      )}
      {!hasVisibleContent && <p className="noteText emptyNote">No note.</p>}
    </div>
  );
}

function renderNote(
  note: string,
  attachmentSources: Record<string, string>,
  variant: SnippetNotePreviewProps["variant"]
): ReactNode[] {
  const parts: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of note.matchAll(NOTE_IMAGE_TOKEN_PATTERN)) {
    const matchText = match[0];
    const attachmentId = match[1];
    const index = match.index ?? 0;
    const text = note.slice(lastIndex, index).trim();

    if (text) {
      parts.push(
        <p key={`text-${index}`} className="noteText">
          {text}
        </p>
      );
    }

    const src = attachmentSources[attachmentId];
    if (src) {
      parts.push(
        <img
          key={`image-${attachmentId}`}
          className={`embeddedNoteImage ${variant}NoteImage`}
          src={src}
          alt="Embedded note attachment"
        />
      );
    } else {
      parts.push(
        <p key={`missing-${attachmentId}`} className="noteImageToken">
          {matchText}
        </p>
      );
    }

    lastIndex = index + matchText.length;
  }

  const tail = note.slice(lastIndex).trim();
  if (tail) {
    parts.push(
      <p key={`text-tail-${lastIndex}`} className="noteText">
        {tail}
      </p>
    );
  }

  return parts;
}

function AttachmentGrid({
  attachments,
  sources,
  variant
}: {
  attachments: Attachment[];
  sources: Record<string, string>;
  variant: SnippetNotePreviewProps["variant"];
}) {
  return (
    <div className={`noteAttachmentGrid ${variant}AttachmentGrid`}>
      {attachments.map((attachment) => (
        <figure key={attachment.id} className="noteAttachmentCard">
          <img src={sources[attachment.id]} alt="Attached clipboard capture" />
          {variant === "detail" && attachment.width && attachment.height && (
            <figcaption>
              {attachment.width} x {attachment.height}
            </figcaption>
          )}
        </figure>
      ))}
    </div>
  );
}

function extractReferencedAttachmentIds(note: string): Set<string> {
  return new Set(Array.from(note.matchAll(NOTE_IMAGE_TOKEN_PATTERN), (match) => match[1]));
}
