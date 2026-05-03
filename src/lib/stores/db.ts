/**
 * db.ts — IndexedDB persistence for the photo library
 *
 * Stores a stripped-down version of each Photo (no blob URLs — those are
 * tab-scoped and must be re-fetched on each page load).
 *
 * Schema:
 *   DB name:    tethr
 *   Store:      photos  (keyPath: id, which is a UUIDv7)
 *   Index:      capturedAt  (for sorted iteration)
 */

import type { Photo, ShootingSettings } from './photos.svelte';

/** The subset of Photo that gets persisted to IndexedDB */
export interface PersistedPhoto {
  id: string;              // UUIDv7
  dirname: string;
  filename: string;
  variants: string[];
  hasRaw: boolean;
  state: 'loading' | 'thumbnail' | 'display' | 'fullres'; // stored but reset on load
  capturedAt: string;      // ISO string (Date isn't serialisable via structured clone in all envs)
  settings: ShootingSettings | null;
  /** Stem key used for RAW+JPG deduplication — dirname/stem(filename) */
  stemKey: string;
}

const DB_NAME = 'tethr';
const DB_VERSION = 1;
const STORE = 'photos';

let _db: IDBDatabase | null = null;

function openDb(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('capturedAt', 'capturedAt', { unique: false });
        store.createIndex('stemKey',    'stemKey',    { unique: false });
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror   = () => reject(req.error);
  });
}

/** Load all persisted photos, sorted newest-first */
export async function dbLoadAll(): Promise<PersistedPhoto[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).index('capturedAt').getAll();
    req.onsuccess = () => {
      // Index is ascending; reverse for newest-first
      resolve((req.result as PersistedPhoto[]).reverse());
    };
    req.onerror = () => reject(req.error);
  });
}

/** Upsert a photo record */
export async function dbUpsert(photo: PersistedPhoto): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(photo);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

/** Find a persisted record by stemKey (for RAW+JPG merge) */
export async function dbFindByStemKey(stemKey: string): Promise<PersistedPhoto | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).index('stemKey').get(stemKey);
    req.onsuccess = () => resolve((req.result as PersistedPhoto | undefined) ?? null);
    req.onerror   = () => reject(req.error);
  });
}

/** Delete a single photo by ID */
export async function dbDelete(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

/** Clear ALL photos from the store */
export async function dbClearAll(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

/** Convert a Photo to its persisted form.
 *  Uses JSON round-trip to strip any Svelte $state Proxy wrappers, which
 *  are not serialisable by the structured-clone algorithm used by IndexedDB.
 */
export function toPersistedPhoto(photo: Photo, stemKey: string): PersistedPhoto {
  const raw: PersistedPhoto = {
    id:         photo.id,
    dirname:    photo.dirname,
    filename:   photo.filename,
    variants:   [...photo.variants],    // plain array copy
    hasRaw:     photo.hasRaw,
    state:      photo.state,
    capturedAt: photo.capturedAt.toISOString(),
    settings:   photo.settings ? JSON.parse(JSON.stringify(photo.settings)) : null,
    stemKey,
  };
  return raw;
}
