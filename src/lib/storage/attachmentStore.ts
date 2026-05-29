const DB_NAME = "codestock-attachments";
const DB_VERSION = 1;
const STORE_NAME = "payloads";
const LEGACY_STORAGE_PREFIX = "codestock:attachment:";

interface AttachmentPayloadRecord {
  id: string;
  bytesBase64: string;
}

export async function saveAttachmentPayload(
  attachmentId: string,
  bytesBase64: string
): Promise<void> {
  try {
    await runRequest("readwrite", (store) =>
      store.put({
        id: attachmentId,
        bytesBase64
      } satisfies AttachmentPayloadRecord)
    );
    window.localStorage.removeItem(legacyKey(attachmentId));
  } catch {
    try {
      window.localStorage.setItem(legacyKey(attachmentId), bytesBase64);
    } catch {
      throw new Error(
        "Image is too large for browser storage. IndexedDB write failed before localStorage fallback."
      );
    }
  }
}

export async function readAttachmentPayload(attachmentId: string): Promise<string | null> {
  const record = await runRequest<AttachmentPayloadRecord | undefined>("readonly", (store) =>
    store.get(attachmentId)
  ).catch(() => undefined);

  if (record?.bytesBase64) {
    return record.bytesBase64;
  }

  const legacyPayload = window.localStorage.getItem(legacyKey(attachmentId));
  if (legacyPayload) {
    await saveAttachmentPayload(attachmentId, legacyPayload).catch(() => undefined);
  }

  return legacyPayload;
}

export async function deleteAttachmentPayload(attachmentId: string): Promise<void> {
  await runRequest("readwrite", (store) => store.delete(attachmentId)).catch(() => undefined);
  window.localStorage.removeItem(legacyKey(attachmentId));
}

export async function migrateLegacyAttachmentPayloads(attachmentIds: string[]): Promise<void> {
  const allAttachmentIds = new Set([
    ...attachmentIds,
    ...Object.keys(window.localStorage)
      .filter((key) => key.startsWith(LEGACY_STORAGE_PREFIX))
      .map((key) => key.slice(LEGACY_STORAGE_PREFIX.length))
  ]);

  for (const attachmentId of allAttachmentIds) {
    const payload = window.localStorage.getItem(legacyKey(attachmentId));
    if (payload) {
      await saveAttachmentPayload(attachmentId, payload).catch(() => undefined);
    }
  }
}

function legacyKey(attachmentId: string): string {
  return `${LEGACY_STORAGE_PREFIX}${attachmentId}`;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("IndexedDB is unavailable."));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Attachment database upgrade was blocked."));
  });
}

function runRequest<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, mode);
        const request = operation(transaction.objectStore(STORE_NAME));
        let result!: T;

        request.onsuccess = () => {
          result = request.result;
        };

        transaction.oncomplete = () => {
          db.close();
          resolve(result);
        };

        transaction.onerror = () => {
          db.close();
          reject(transaction.error ?? request.error);
        };

        transaction.onabort = () => {
          db.close();
          reject(transaction.error ?? request.error);
        };
      })
  );
}
