import { browser } from '$app/environment';
import { uuidv7 } from 'uuidv7';
import { dbClearAll, dbFindByStemKey, dbLoadAll, dbUpsert, toPersistedPhoto } from './db';

export type PhotoState = 'loading' | 'thumbnail' | 'display' | 'fullres';

export interface ShootingSettings {
  av:           string | null;  // aperture e.g. "f2.8"
  tv:           string | null;  // shutter e.g. "1/125"
  iso:          string | null;  // ISO e.g. "3200"
  mode:         string | null;  // shooting mode dial e.g. "av", "m"
  wb:           string | null;  // white balance e.g. "colortemp", "auto"
  colortemp:    number | null;  // colour temperature in K (when wb=colortemp)
  exposure:     string | null;  // exposure compensation e.g. "+0.0", "-1_1/3"
  metering:     string | null;  // metering mode e.g. "evaluative", "spot"
  drive:        string | null;  // drive mode e.g. "single", "highspeed"
  afoperation:  string | null;  // AF operation e.g. "manual", "oneshot"
}

/** Canon RAW formats — CR3 (R-series) and CR2 (legacy DSLR) */
const RAW_EXTS = new Set(['.cr3', '.cr2']);

function stem(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? filename : filename.slice(0, dot);
}

function ext(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot).toLowerCase();
}

export interface Photo {
  /**
   * Stable unique ID — UUIDv7 (time-ordered).
   * Generated once when the shot first arrives; persisted across sessions.
   * NOTE: unlike the old "dirname/stem" ID, this never changes and is safe
   * to use as a React/Svelte key even when RAW+JPG variants merge.
   */
  id: string;
  dirname: string;
  /** Display filename — prefer JPG; falls back to whatever arrived first */
  filename: string;
  /** All filenames for this shot (e.g. ["IMG_0001.JPG", "IMG_0001.CR3"]) */
  variants: string[];
  hasRaw: boolean;
  thumbnailUrl: string | null;   // blob URL — tab-scoped, not persisted
  displayUrl: string | null;     // blob URL — tab-scoped, not persisted
  fullresUrl: string | null;     // blob URL — tab-scoped, not persisted
  displayProgress: number | null; // 0–100 during fetch, null when idle
  state: PhotoState;
  capturedAt: Date;
  /** Shooting settings at capture time — from monitoring stream */
  settings: ShootingSettings | null;
}

export const photosStore = (() => {
  let photos = $state<Photo[]>([]);

  /**
   * stemKey: the deduplication key used to find RAW+JPG pairs.
   * Separate from photo.id (which is UUIDv7) — stored in IndexedDB for lookup.
   */
  const stemKeyMap = new Map<string, string>(); // stemKey → UUIDv7 id

  /** Load persisted photos from IndexedDB on first browser render */
  async function init() {
    if (!browser) return;
    try {
      const persisted = await dbLoadAll();
      const loaded: Photo[] = persisted.map(p => ({
        id:              p.id,
        dirname:         p.dirname,
        filename:        p.filename,
        variants:        p.variants,
        hasRaw:          p.hasRaw,
        thumbnailUrl:    null,   // blob URLs don't survive page reload
        displayUrl:      null,
        fullresUrl:      null,
        displayProgress: null,   // reset so idle prefetch re-triggers
        state:           'loading',
        capturedAt:      new Date(p.capturedAt),
        settings:        p.settings,
      }));
      // Rebuild stemKey lookup from persisted records
      for (const p of persisted) stemKeyMap.set(p.stemKey, p.id);
      photos = loaded;
    } catch (e) {
      console.warn('[photos] Failed to load from IndexedDB:', e);
    }
  }

  /**
   * Add or update a photo card for the given dirname/filename.
   * If a card with the same stem already exists, add the filename as a variant.
   * Returns the card's UUIDv7 id.
   */
  function addOrMerge(dirname: string, filename: string, settings: ShootingSettings | null = null): string {
    const key = `${dirname}/${stem(filename)}`;
    const existingId = stemKeyMap.get(key);

    if (existingId) {
      const existing = photos.find(p => p.id === existingId);
      if (existing && !existing.variants.includes(filename)) {
        const isJpg = !RAW_EXTS.has(ext(filename));
        const updated: Photo = {
          ...existing,
          variants: [...existing.variants, filename],
          filename: isJpg ? filename : existing.filename,
          hasRaw: existing.hasRaw || RAW_EXTS.has(ext(filename)),
          settings: existing.settings ?? settings,
        };
        photos = photos.map(p => p.id !== existingId ? p : updated);
        // Persist the merged record
        if (browser) dbUpsert(toPersistedPhoto(updated, key)).catch(console.warn);
      }
      return existingId;
    }

    // New shot — generate a UUIDv7 id
    const id = uuidv7();
    stemKeyMap.set(key, id);

    const photo: Photo = {
      id,
      dirname,
      filename,
      variants: [filename],
      hasRaw: RAW_EXTS.has(ext(filename)),
      thumbnailUrl: null,
      displayUrl: null,
      fullresUrl: null,
      displayProgress: null,
      state: 'loading',
      capturedAt: new Date(),
      settings,
    };

    photos = [photo, ...photos];

    // Persist asynchronously
    if (browser) dbUpsert(toPersistedPhoto(photo, key)).catch(console.warn);

    return id;
  }

  function setThumbnail(id: string, url: string) {
    photos = photos.map(p =>
      p.id === id ? { ...p, thumbnailUrl: url, state: 'thumbnail' } : p
    );
  }

  function setDisplay(id: string, url: string) {
    photos = photos.map(p =>
      p.id === id ? { ...p, displayUrl: url, displayProgress: null, state: 'display' } : p
    );
  }

  function setDisplayProgress(id: string, progress: number | null) {
    photos = photos.map(p =>
      p.id === id ? { ...p, displayProgress: progress } : p
    );
  }

  function setFullres(id: string, url: string) {
    photos = photos.map(p =>
      p.id === id ? { ...p, fullresUrl: url, state: 'fullres' } : p
    );
  }

  function clear() { photos = []; }

  /** Clear all photos from memory and IndexedDB */
  async function clearAll() {
    photos = [];
    stemKeyMap.clear();
    if (browser) {
      try { await dbClearAll(); } catch (e) { console.warn('[photos] clearAll DB error:', e); }
    }
  }

  return {
    get photos() { return photos; },
    init,
    addOrMerge,
    setThumbnail,
    setDisplay,
    setDisplayProgress,
    setFullres,
    clear,
    clearAll,
  };
})();
