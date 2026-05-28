import type { SnippetLanguage } from "../types";

export const SNIPPET_LANGUAGES: SnippetLanguage[] = [
  "TypeScript",
  "JavaScript",
  "TSX",
  "JSX",
  "Python",
  "Shell",
  "SQL",
  "JSON",
  "HTML",
  "CSS",
  "SCSS",
  "Other"
];

export const DEFAULT_SNIPPET_LANGUAGE: SnippetLanguage = "TypeScript";

export const DEFAULT_SNIPPET_CODE = `function solveProblem() {
  return "ship fast";
}`;
