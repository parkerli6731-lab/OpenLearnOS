import type { DocumentChunk } from "@openlearnos/contracts";

const DB_NAME = "openlearnos_local_store_v1";
const STORE_NAME = "kv";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = window.indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

export async function saveUploadedChunks(chunks: readonly DocumentChunk[]): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put([...chunks], "uploaded_chunks");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Graceful no-op in restricted private browsing modes
  }
}

export async function loadUploadedChunks(): Promise<readonly DocumentChunk[]> {
  try {
    const db = await openDb();
    return await new Promise<readonly DocumentChunk[]>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get("uploaded_chunks");
      req.onsuccess = () => resolve(Array.isArray(req.result) ? (req.result as DocumentChunk[]) : []);
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

const DELETED_DOCS_KEY = "openlearnos_deleted_docs_v1";

export function loadDeletedDocIds(): Set<string> {
  try {
    const raw = window.localStorage.getItem(DELETED_DOCS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? (arr as string[]) : []);
  } catch {
    return new Set();
  }
}

export function saveDeletedDocIds(ids: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(DELETED_DOCS_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // Graceful no-op in restricted private browsing modes
  }
}

export function clearDeletedDocIds(): void {
  try {
    window.localStorage.removeItem(DELETED_DOCS_KEY);
  } catch {
    // Graceful no-op
  }
}
