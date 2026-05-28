export type SnippetLanguage =
  | "TypeScript"
  | "JavaScript"
  | "TSX"
  | "JSX"
  | "Python"
  | "Shell"
  | "SQL"
  | "JSON"
  | "HTML"
  | "CSS"
  | "SCSS"
  | "Other";

export type SnippetSort = "updatedAt" | "createdAt";

export interface Attachment {
  id: string;
  snippetId: string;
  filePath: string;
  mimeType: string;
  width?: number;
  height?: number;
  createdAt: string;
}

export interface Tag {
  id: string;
  name: string;
  normalizedName: string;
}

export interface SnippetCodeBlock {
  id: string;
  language: SnippetLanguage;
  code: string;
}

export interface Snippet {
  id: string;
  title: string;
  code: string;
  language: SnippetLanguage;
  codeBlocks: SnippetCodeBlock[];
  note: string;
  tags: Tag[];
  attachments: Attachment[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateSnippetInput {
  title: string;
  codeBlocks: SnippetCodeBlock[];
  note: string;
  tags: string[];
}

export interface UpdateSnippetInput extends CreateSnippetInput {}

export interface SearchSnippetsInput {
  query: string;
  tags: string[];
  sort: SnippetSort;
}

export interface ClipboardAttachmentDraft {
  draftId: string;
  fileName: string;
  mimeType: string;
  bytesBase64: string;
  width?: number;
  height?: number;
}
