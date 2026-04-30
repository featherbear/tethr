export type PhotoState = 'loading' | 'thumbnail' | 'fullres';

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
  /** Canonical ID — dirname/stem (without extension) so RAW+JPG share one card */
  id: string;
  dirname: string;
  /** Display filename — prefer JPG; falls back to whatever arrived first */
  filename: string;
  /** All filenames for this shot (e.g. ["IMG_0001.JPG", "IMG_0001.CR3"]) */
  variants: string[];
  hasRaw: boolean;
  thumbnailUrl: string | null;
  fullresUrl: string | null;
  state: PhotoState;
  capturedAt: Date;
  /** Shooting settings at capture time — from monitoring stream */
  settings: ShootingSettings | null;
}

export const photosStore = (() => {
  let photos = $state<Photo[]>([]);

  /**
   * Add or update a photo card for the given dirname/filename.
   * If a card with the same stem already exists, add the filename as a variant.
   * Returns the card ID (dirname/stem).
   */
  function addOrMerge(dirname: string, filename: string, settings: ShootingSettings | null = null): string {
    const cardId = `${dirname}/${stem(filename)}`;
    const existing = photos.find(p => p.id === cardId);

    if (existing) {
      // Already have a card — add this variant if not already tracked
      if (!existing.variants.includes(filename)) {
        const isJpg = !RAW_EXTS.has(ext(filename));
        photos = photos.map(p => p.id !== cardId ? p : {
          ...p,
          variants: [...p.variants, filename],
          // Prefer JPG as display filename
          filename: isJpg ? filename : p.filename,
          hasRaw: p.hasRaw || RAW_EXTS.has(ext(filename)),
          // Keep settings from first arrival
          settings: p.settings ?? settings,
        });
      }
      return cardId;
    }

    // New card
    photos = [{
      id: cardId,
      dirname,
      filename,
      variants: [filename],
      hasRaw: RAW_EXTS.has(ext(filename)),
      thumbnailUrl: null,
      fullresUrl: null,
      state: 'loading',
      capturedAt: new Date(),
      settings,
    }, ...photos];

    return cardId;
  }

  function setThumbnail(id: string, url: string) {
    photos = photos.map(p =>
      p.id === id ? { ...p, thumbnailUrl: url, state: 'thumbnail' } : p
    );
  }

  function setFullres(id: string, url: string) {
    photos = photos.map(p =>
      p.id === id ? { ...p, fullresUrl: url, state: 'fullres' } : p
    );
  }

  function clear() { photos = []; }

  return {
    get photos() { return photos; },
    addOrMerge,
    setThumbnail,
    setFullres,
    clear,
  };
})();
