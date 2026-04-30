export type PhotoState = 'loading' | 'thumbnail' | 'fullres';

export interface Photo {
  id: string;         // dirname/filename
  dirname: string;
  filename: string;
  thumbnailUrl: string | null;
  fullresUrl: string | null;
  state: PhotoState;
  capturedAt: Date;
}

export const photosStore = (() => {
  let photos = $state<Photo[]>([]);

  function addPlaceholder(dirname: string, filename: string): string {
    const id = `${dirname}/${filename}`;
    // Avoid duplicates
    if (photos.some(p => p.id === id)) return id;
    photos = [{
      id,
      dirname,
      filename,
      thumbnailUrl: null,
      fullresUrl: null,
      state: 'loading',
      capturedAt: new Date(),
    }, ...photos];
    return id;
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

  function clear() {
    photos = [];
  }

  return {
    get photos() { return photos; },
    addPlaceholder,
    setThumbnail,
    setFullres,
    clear,
  };
})();
