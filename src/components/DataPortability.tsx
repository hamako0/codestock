import { useRef, useState } from "react";
import { base64ToBlob, blobToBase64 } from "../lib/utils";
import type { PortableExportResult, PortableImportResult } from "../types";

interface DataPortabilityProps {
  onExportData(): Promise<PortableExportResult>;
  onImportData(bytesBase64: string): Promise<PortableImportResult>;
}

export function DataPortability({ onExportData, onImportData }: DataPortabilityProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleExport() {
    setBusy(true);
    setStatus("Exporting...");
    try {
      const result = await onExportData();
      downloadExport(result);
      const pathText = result.filePath ? ` Saved at ${result.filePath}` : "";
      setStatus(
        `Exported ${result.snippetCount} snippets and ${result.attachmentCount} images.${pathText}`
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleImport(file: File | null) {
    if (!file) {
      return;
    }

    setBusy(true);
    setStatus("Importing...");
    try {
      const bytesBase64 = await blobToBase64(file);
      const result = await onImportData(bytesBase64);
      setStatus(
        `Imported ${result.importedSnippets} snippets and ${result.importedAttachments} images.`
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setBusy(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  return (
    <div className="portabilityPanel">
      <div className="actionRow">
        <button className="ghostButton" disabled={busy} onClick={() => void handleExport()}>
          Export
        </button>
        <button
          className="ghostButton"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
        >
          Import
        </button>
      </div>
      <input
        ref={fileInputRef}
        className="hiddenFileInput"
        type="file"
        accept=".zip,.json,application/zip,application/json"
        onChange={(event) => void handleImport(event.target.files?.[0] ?? null)}
      />
      {status && <p className="statusText portabilityStatus">{status}</p>}
    </div>
  );
}

function downloadExport(result: PortableExportResult): void {
  const blob = base64ToBlob(result.bytesBase64, result.mimeType);
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = result.fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}
