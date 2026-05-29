import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_SNIPPET_CODE,
  DEFAULT_SNIPPET_LANGUAGE,
  SNIPPET_LANGUAGES
} from "../lib/constants";
import { blobToBase64, generateId } from "../lib/utils";
import { measureImage } from "../lib/image";
import type {
  ClipboardAttachmentDraft,
  CreateSnippetInput,
  Snippet,
  SnippetCodeBlock,
  Tag,
  UpdateSnippetInput
} from "../types";

interface SnippetComposerProps {
  availableTags: Tag[];
  selectedSnippet: Snippet | null;
  onBeginNewSnippet(): void;
  onCreateSnippet(input: CreateSnippetInput): Promise<Snippet>;
  onUpdateSnippet(id: string, input: UpdateSnippetInput): Promise<void>;
  onAttachImageFromClipboard(draft: ClipboardAttachmentDraft, snippetId: string): Promise<Snippet>;
  onRefreshTags(keyword: string): Promise<void>;
}

const NOTE_IMAGE_TOKEN_PREFIX = "[image:";

function tagsToText(tags: Tag[]): string {
  return tags.map((tag) => tag.name).join(", ");
}

function parseTagInput(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function SnippetComposer({
  availableTags,
  selectedSnippet,
  onBeginNewSnippet,
  onCreateSnippet,
  onUpdateSnippet,
  onAttachImageFromClipboard,
  onRefreshTags
}: SnippetComposerProps) {
  const [title, setTitle] = useState("");
  const [codeBlocks, setCodeBlocks] = useState<SnippetCodeBlock[]>([buildDefaultCodeBlock()]);
  const [note, setNote] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [status, setStatus] = useState("Paste an image with Ctrl+V after saving.");
  const noteRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!selectedSnippet) {
      setTitle("");
      setCodeBlocks([buildDefaultCodeBlock()]);
      setNote("");
      setTagInput("");
      setStatus("Create a new snippet. Paste an image after saving.");
      return;
    }

    setTitle(selectedSnippet.title);
    setCodeBlocks(selectedSnippet.codeBlocks);
    setNote(selectedSnippet.note);
    setTagInput(tagsToText(selectedSnippet.tags));
    setStatus("Editing existing snippet.");
  }, [selectedSnippet]);

  async function handleSubmit() {
    const input = {
      title,
      codeBlocks: codeBlocks.map((block) => ({
        ...block,
        code: block.code
      })),
      note,
      tags: parseTagInput(tagInput)
    };

    if (selectedSnippet) {
      await onUpdateSnippet(selectedSnippet.id, input);
      setStatus("Snippet updated.");
      return;
    }

    await onCreateSnippet(input);
    setStatus("Snippet created. You can paste an image now.");
  }

  function updateCodeBlock(id: string, patch: Partial<SnippetCodeBlock>) {
    setCodeBlocks((current) =>
      current.map((block) => (block.id === id ? { ...block, ...patch } : block))
    );
  }

  function addCodeBlock() {
    setCodeBlocks((current) => [
      ...current,
      {
        id: generateId("block"),
        language: current[current.length - 1]?.language ?? DEFAULT_SNIPPET_LANGUAGE,
        code: ""
      }
    ]);
  }

  function removeCodeBlock(id: string) {
    setCodeBlocks((current) => {
      if (current.length === 1) {
        return current;
      }
      return current.filter((block) => block.id !== id);
    });
  }

  async function handleNotePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const imageItem = Array.from(event.clipboardData.items).find((item) =>
      item.type.startsWith("image/")
    );
    if (!imageItem) {
      return;
    }

    event.preventDefault();
    const file = imageItem.getAsFile();
    if (!file) {
      return;
    }

    try {
    const base64 = await blobToBase64(file);
    const dataUrl = `data:${file.type};base64,${base64}`;
    const dimensions = await measureImage(dataUrl);
    const draft: ClipboardAttachmentDraft = {
      draftId: generateId("draft"),
      fileName: `${generateId("capture")}.png`,
      mimeType: file.type,
      bytesBase64: base64,
      width: dimensions.width,
      height: dimensions.height
    };

    const baseInput = {
      title,
      codeBlocks: codeBlocks.map((block) => ({
        ...block,
        code: block.code
      })),
      note,
      tags: parseTagInput(tagInput)
    };

    const targetSnippet =
      selectedSnippet ??
      (await onCreateSnippet({
        ...baseInput,
        note
      }));

    const nextSnippet = await onAttachImageFromClipboard(draft, targetSnippet.id);
    const insertedAttachment = nextSnippet.attachments[0];
    if (!insertedAttachment) {
      setStatus("Image attached, but note marker could not be inserted.");
      return;
    }

    const token = `${NOTE_IMAGE_TOKEN_PREFIX}${insertedAttachment.id}]`;
    const textarea = noteRef.current;
    const selectionStart = textarea?.selectionStart ?? note.length;
    const selectionEnd = textarea?.selectionEnd ?? note.length;
    const prefix = note.slice(0, selectionStart);
    const suffix = note.slice(selectionEnd);
    const spacerBefore = prefix && !prefix.endsWith("\n") ? "\n" : "";
    const spacerAfter = suffix && !suffix.startsWith("\n") ? "\n" : "";
    const nextNote = `${prefix}${spacerBefore}${token}${spacerAfter}${suffix}`;

    setNote(nextNote);
    await onUpdateSnippet(targetSnippet.id, {
      ...baseInput,
      note: nextNote,
    });
    setStatus("Image embedded into note.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Image could not be saved.");
    }
  }

  const suggestedTags = availableTags.filter((tag) =>
    tagInput
      .toLowerCase()
      .split(",")
      .map((value) => value.trim())
      .some((needle) => needle && tag.normalizedName.includes(needle))
  );

  return (
    <section className="panel composer">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">Capture</p>
          <h2>{selectedSnippet ? "Edit Snippet" : "New Snippet"}</h2>
        </div>
        <div className="actionRow">
          {selectedSnippet && (
            <button className="ghostButton" onClick={onBeginNewSnippet}>
              New Draft
            </button>
          )}
          <button className="primaryButton" onClick={() => void handleSubmit()}>
            {selectedSnippet ? "Update" : "Save"}
          </button>
        </div>
      </div>

      <label className="field">
        <span>Title</span>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="JWT decode helper"
        />
      </label>

      <div className="field">
        <span>Code Blocks</span>
        <div className="codeBlockStack">
          {codeBlocks.map((block, index) => (
            <div key={block.id} className="codeBlockCard">
              <div className="codeBlockHeader">
                <strong>Block {index + 1}</strong>
                <div className="actionRow">
                  <select
                    value={block.language}
                    onChange={(event) =>
                      updateCodeBlock(block.id, {
                        language: event.target.value as (typeof SNIPPET_LANGUAGES)[number]
                      })
                    }
                  >
                    {SNIPPET_LANGUAGES.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                  <button
                    className="ghostButton"
                    onClick={() => removeCodeBlock(block.id)}
                    disabled={codeBlocks.length === 1}
                  >
                    Remove
                  </button>
                </div>
              </div>
              <textarea
                className="codeArea"
                value={block.code}
                onChange={(event) => updateCodeBlock(block.id, { code: event.target.value })}
                spellCheck={false}
              />
            </div>
          ))}
        </div>
        <button className="ghostButton addBlockButton" onClick={addCodeBlock}>
          Add Code Block
        </button>
      </div>

      <label className="field">
        <span>Note</span>
        <textarea
          ref={noteRef}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          onPaste={(event) => void handleNotePaste(event)}
          placeholder="why this exists, caveats, links..."
        />
      </label>

      <label className="field">
        <span>Tags</span>
        <input
          value={tagInput}
          onChange={(event) => {
            const value = event.target.value;
            setTagInput(value);
            void onRefreshTags(value);
          }}
          placeholder="auth, jwt, utility"
        />
      </label>

      {suggestedTags.length > 0 && (
        <div className="suggestions">
          {suggestedTags.slice(0, 8).map((tag) => (
            <button
              key={tag.id}
              className="chip"
              onClick={() => {
                const values = new Set([...parseTagInput(tagInput), tag.name]);
                setTagInput(Array.from(values).join(", "));
              }}
            >
              #{tag.name}
            </button>
          ))}
        </div>
      )}

      <p className="statusText">{status}</p>
    </section>
  );
}

function buildDefaultCodeBlock(): SnippetCodeBlock {
  return {
    id: generateId("block"),
    language: DEFAULT_SNIPPET_LANGUAGE,
    code: DEFAULT_SNIPPET_CODE
  };
}
