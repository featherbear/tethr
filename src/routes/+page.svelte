<script lang="ts">
  import { onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { cameraStore } from '$lib/stores/camera.svelte';
  import { photosStore } from '$lib/stores/photos.svelte';
  import { cameraInfoStore } from '$lib/stores/cameraInfo.svelte';
  import type { ShootingSettings } from '$lib/stores/photos.svelte';
  import StatusBar from '$lib/components/StatusBar.svelte';
  import PhotoGrid from '$lib/components/PhotoGrid.svelte';
  import SettingsModal from '$lib/components/SettingsModal.svelte';
  import ConfirmClearModal from '$lib/components/ConfirmClearModal.svelte';
  import Lightbox from '$lib/components/Lightbox.svelte';
  import { childLog } from '$lib/logger';

  const log = childLog('page');

  let eventSource: EventSource | null = null;
  let showSettings = $state(false);
  let showClear = $state(false);
  let lightboxIndex = $state<number | null>(null);
  let liveSettings = $state<ShootingSettings | null>(null);

  // Load persisted photos from IndexedDB, then enqueue image fetches.
  // For each restored photo, check the Cache API first:
  //   - HD cached   → enqueue full directly (cache hit is instant, skip thumbnail wait)
  //   - Thumb cached → enqueue thumbnail (idle prefetch handles HD later)
  //   - Neither      → enqueue thumbnail (will be fetched from camera)
  if (browser) {
    photosStore.init().then(async () => {
      for (const photo of photosStore.photos) {
        const hasFull  = !!(await getCachedBlob(fullCacheKey(photo.id)));
        const hasThumb = !hasFull && !!(await getCachedBlob(thumbCacheKey(photo.id)));

        if (hasFull) {
          // HD already cached — load it directly, no thumbnail needed
          enqueueFull(photo.id, P.FullIdle);
        } else {
          // Load thumbnail (from cache or camera); idle prefetch handles HD later
          const filename = photo.variants.find(v => /\.jpe?g$/i.test(v)) ?? photo.variants[0];
          if (filename) enqueueThumbnail(photo.id, photo.dirname, filename);
        }
      }
      // If any photos had only thumbnails, schedule idle prefetch for their HD images
      if (photosStore.photos.some(p => !p.fullUrl)) {
        idlePrefetchTimer = setTimeout(runIdlePrefetch, 1_000);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Single global serial camera fetch queue — CCAPI is single-threaded,
  // all camera requests (thumbnail + display) must be serialised.
  // ---------------------------------------------------------------------------
  const P = {
    Thumbnail:      0,  // urgent — JPG thumbnail for new shot
    FullUrgent:  1,  // urgent — display fetch when lightbox is open (latest shot)
    ThumbnailRaw:   2,  // urgent — RAW thumbnail (fallback if no JPG)
    FullNow:     3,  // on-demand — lightbox open / navigate (non-latest)
    FullIdle:    4,  // background — idle prefetch
  } as const;
  type PValue = typeof P[keyof typeof P];

  type ThumbJob   = { type: 'thumb';   id: string; dirname: string; filename: string; priority: PValue; seq: number };
  type FullJob = { type: 'full'; id: string; priority: PValue; seq: number };
  type Job = ThumbJob | FullJob;

  const fetchQueue: Job[] = [];
  let fetchRunning = false;
  let jobSeq = 0; // monotonically increasing — newer jobs have higher seq

  function enqueueJob(job: Omit<ThumbJob, 'seq'> | Omit<FullJob, 'seq'>) {
    const seq = ++jobSeq;
    // For thumbnail jobs: replace existing lower-priority job for same id
    if (job.type === 'thumb') {
      const existing = fetchQueue.findIndex(j => j.type === 'thumb' && j.id === job.id);
      if (existing !== -1) {
        if (fetchQueue[existing].priority <= job.priority) return;
        fetchQueue.splice(existing, 1);
      }
    }
    // For display jobs: skip if already loaded, in progress, or already queued
    if (job.type === 'full') {
      const photo = photosStore.photos.find(p => p.id === job.id);
      if (!photo || photo.fullUrl) return;
      // Skip if already queued
      if (fetchQueue.some(j => j.type === 'full' && j.id === job.id)) return;
      // Skip if in-flight — abort resets fullProgress to null via catch block,
      // so after abortCurrentDisplayFetch() this check passes correctly
      if (photo.fullProgress !== null) return;
    }
    fetchQueue.push({ ...job, seq } as Job);
    // Sort key: [photo recency DESC (lower index = newer), then thumb before display, then seq DESC]
    // This ensures newest photo loads completely (thumb then display) before older photos
    const photoIndex = (j: Job) => {
      const i = photosStore.photos.findIndex(p => p.id === j.id);
      return i === -1 ? 999 : i; // lower index = newer photo
    };
    const typeOrder = (j: Job) => {
      // Within a photo: thumb before display; urgent display before raw thumb
      if (j.type === 'thumb' && j.priority === P.Thumbnail) return 0;
      if (j.type === 'full' && j.priority === P.FullUrgent) return 1;
      if (j.type === 'thumb' && j.priority === P.ThumbnailRaw) return 2;
      if (j.type === 'full' && j.priority === P.FullNow) return 3;
      return 4; // FullIdle
    };
    fetchQueue.sort((a, b) => {
      const pa = photoIndex(a), pb = photoIndex(b);
      if (pa !== pb) return pa - pb; // newer photo first
      return typeOrder(a) - typeOrder(b); // within same photo: thumb → urgent display → raw thumb → display
    });
    processFetchQueue();
  }

  async function processFetchQueue() {
    if (fetchRunning) return;
    fetchRunning = true;
    while (fetchQueue.length > 0) {
      const job = fetchQueue.shift()!;
      if (job.type === 'thumb') {
        const card = photosStore.photos.find(p => p.id === job.id);
        if (job.priority === P.ThumbnailRaw && card?.thumbnailUrl) continue; // RAW skipped if JPG thumb loaded
        await fetchThumbnail(job.id, job.dirname, job.filename);
      } else {
        await fetchFull(job.id);
      }
    }
    fetchRunning = false;
  }

  function enqueueThumbnail(id: string, dirname: string, filename: string) {
    // Skip if thumbnail already loaded — no need to re-fetch
    const existing = photosStore.photos.find(p => p.id === id);
    if (existing?.thumbnailUrl) return;
    const priority = /\.(cr3|cr2)$/i.test(filename) ? P.ThumbnailRaw : P.Thumbnail;
    enqueueJob({ type: 'thumb', id, dirname, filename, priority });
  }

  function enqueueFull(id: string, priority: typeof P.FullUrgent | typeof P.FullNow | typeof P.FullIdle) {
    enqueueJob({ type: 'full', id, priority });
  }

  // ---------------------------------------------------------------------------
  // Initial state load
  // ---------------------------------------------------------------------------
  async function loadInitialState() {
    if (!browser) return;
    try {
      const res = await fetch('/api/state');
      if (!res.ok) return;
      const { status, error, cameraInfo } = await res.json();
      log.info({ status, cameraInfo: cameraInfo?.productname }, 'Initial state loaded');
      cameraStore.setStatus(status, error ?? undefined);
      if (cameraInfo) cameraInfoStore.set(cameraInfo);
    } catch (e) {
      log.warn({ err: e }, 'Failed to load initial state');
    }

  }

  // ---------------------------------------------------------------------------
  // SSE subscription
  // ---------------------------------------------------------------------------
  function startEventStream() {
    if (!browser || eventSource) return;
    log.info('Starting SSE event stream');
    eventSource = new EventSource('/api/events');

    let badAddressTimer: ReturnType<typeof setTimeout> | null = null;

    eventSource.addEventListener('status', (e) => {
      const { status, error } = JSON.parse(e.data);
      log.info({ status, error }, 'SSE status event');
      cameraStore.setStatus(status, error);

      // Fetch camera info when we first go live
      if (status === 'live') {
        // Cancel any pending "bad address" prompt — we connected successfully
        if (badAddressTimer) { clearTimeout(badAddressTimer); badAddressTimer = null; }
        if (!cameraInfoStore.info) fetchCameraInfo();
      }

      // Clear info when disconnected
      if (status === 'stopped' || status === 'connecting') {
        cameraInfoStore.set(null);
      }

      // If we're reconnecting and never successfully connected, the saved address
      // is probably wrong. Show the settings modal after a grace period.
      if (status === 'reconnecting' && !cameraInfoStore.info && !showSettings) {
        if (!badAddressTimer) {
          badAddressTimer = setTimeout(() => {
            badAddressTimer = null;
            if (!cameraInfoStore.info && !showSettings) showSettings = true;
          }, 4_000);
        }
      }
    });

    eventSource.addEventListener('settings', (e) => {
      liveSettings = JSON.parse(e.data) as ShootingSettings;
    });

    eventSource.addEventListener('shot', (e) => {
      const { path, settings } = JSON.parse(e.data) as { path: string; settings: ShootingSettings | null };
      const parts = path.split('/');
      const filename = parts.pop()!;
      const dirname = parts.join('/');
      log.info({ path, filename }, 'Shot event received');
      const id = photosStore.addOrMerge(dirname, filename, settings);
      enqueueThumbnail(id, dirname, filename);
      // Cancel idle prefetch timer and flush pending display jobs — camera is active
      if (idlePrefetchTimer) { clearTimeout(idlePrefetchTimer); idlePrefetchTimer = null; }
      for (let i = fetchQueue.length - 1; i >= 0; i--) {
        if (fetchQueue[i].type === 'full') fetchQueue.splice(i, 1);
      }
      // If lightbox is open, jump to new photo and fetch display at urgent priority
      // Demote any previously urgent display jobs — only the latest is urgent
      if (lightboxIndex !== null) {
        for (const job of fetchQueue) {
          if (job.type === 'full' && job.priority === P.FullUrgent) {
            job.priority = P.FullNow;
          }
        }
        lightboxIndex = 0;
        enqueueFull(id, P.FullUrgent); // enqueueJob re-sorts
      }
    });

    eventSource.addEventListener('info', (e) => {
      const update = JSON.parse(e.data) as { battery?: { level: string; quality: string; name: string } };
      const current = cameraInfoStore.info;
      if (!current) return;
      cameraInfoStore.set({ ...current, battery: update.battery ?? current.battery });
    });

    eventSource.onerror = () => {
      // EventSource reconnects automatically; status updates come via 'status' events
      log.warn('SSE connection error — EventSource will reconnect automatically');
    };
  }

  // ---------------------------------------------------------------------------
  // Camera info
  // ---------------------------------------------------------------------------
  async function fetchCameraInfo() {
    try {
      const res = await fetch('/api/camera/info');
      if (res.ok) cameraInfoStore.set(await res.json());
    } catch { /* non-fatal */ }
  }

  // ---------------------------------------------------------------------------
  // Photo loading
  // ---------------------------------------------------------------------------
  const THUMB_MAX_RETRIES = 4;
  const THUMB_RETRY_DELAY_MS = 1_500;

  // Strip the CCAPI contents prefix from a full camera path to get just the card-relative path.
  // e.g. "/ccapi/ver120/contents/card1/100EOSR6/IMG.CR3" → "card1/100EOSR6/IMG.CR3"
  function toApiPath(fullPath: string): string {
    return fullPath.replace(/^\/?ccapi\/ver\d+\/contents\//, '');
  }

  // ---------------------------------------------------------------------------
  // Image Cache API — keyed by photo UUID (not URL) so filename reuse is safe.
  // Cache entries use synthetic URLs: tethr-cache://thumb/{uuid} etc.
  // ---------------------------------------------------------------------------
  const IMAGE_CACHE = 'tethr-images-v1';

  // Cache API requires valid HTTP(S) URLs — use a fake https origin so match() works
  function thumbCacheKey(id: string)  { return `https://tethr-cache/thumb/${id}`; }
  function fullCacheKey(id: string)   { return `https://tethr-cache/full/${id}`; }

  async function getCachedBlob(cacheKey: string): Promise<Blob | null> {
    try {
      const cache = await caches.open(IMAGE_CACHE);
      const res = await cache.match(cacheKey);
      return res ? res.blob() : null;
    } catch { return null; }
  }

  async function setCachedBlob(cacheKey: string, blob: Blob): Promise<void> {
    try {
      const cache = await caches.open(IMAGE_CACHE);
      await cache.put(cacheKey, new Response(blob, { headers: { 'Content-Type': blob.type || 'image/jpeg' } }));
    } catch { /* non-fatal */ }
  }

  async function fetchThumbnail(id: string, dirname: string, filename: string, attempt = 0) {
    const camPath = toApiPath(`${dirname}/${filename}`);
    const cacheKey = thumbCacheKey(id);
    log.debug({ id, camPath, attempt }, 'Fetching thumbnail');
    try {
      // Check cache first (keyed by UUID — safe even if filenames repeat across sessions)
      let blob = await getCachedBlob(cacheKey);
      if (!blob) {
        const res = await fetch(`/api/thumbnail/${camPath}`);
        if (!res.ok) {
          log.warn({ id, camPath, status: res.status, attempt }, 'Thumbnail fetch failed');
          if (attempt < THUMB_MAX_RETRIES && (res.status === 503 || res.status === 502)) {
            const delay = THUMB_RETRY_DELAY_MS * (attempt + 1);
            await new Promise(r => setTimeout(r, delay));
            enqueueJob({ type: 'thumb', id, dirname, filename, priority: P.Thumbnail });
          }
          return;
        }
        blob = await res.blob();
        setCachedBlob(cacheKey, blob); // fire-and-forget
      } else {
        log.debug({ id }, 'Thumbnail from cache');
      }
      const url = URL.createObjectURL(blob);
      photosStore.setThumbnail(id, url);
      log.info({ id, camPath }, 'Thumbnail loaded');
      const currentPhoto = lightboxIndex !== null ? photosStore.photos[lightboxIndex] : null;
      if (currentPhoto?.id === id) {
        enqueueFull(id, P.FullUrgent);
      } else {
        scheduleIdlePrefetch();
      }
    } catch (e) {
      log.warn({ err: e, id, camPath }, 'Thumbnail fetch threw');
    }
  }

  const DISPLAY_MAX_RETRIES = 3;
  const DISPLAY_RETRY_DELAY_MS = 2_000;

  // Fetch display-quality image (~340KB JPG) with progress tracking.
  // Prefer JPG variant, fall back to CR3/CR2.
  async function fetchFull(id: string, attempt = 0) {
    const photo = photosStore.photos.find(p => p.id === id);
    if (!photo || photo.fullUrl) return; // already fetched

    // Prefer JPG variant, fall back to CR3/CR2 — camera serves display JPEG from RAW too
    const displayVariant = photo.variants.find(v => /\.jpe?g$/i.test(v))
                        ?? photo.variants.find(v => /\.(cr3|cr2)$/i.test(v));
    if (!displayVariant) return;

    const camPath = toApiPath(`${photo.dirname}/${displayVariant}`);
    const cacheKey = fullCacheKey(id);
    log.debug({ id, camPath, attempt }, 'Full image: starting fetch');
    try {
      // Check cache first
      const cached = await getCachedBlob(cacheKey);
      if (cached) {
        log.info({ id, bytes: cached.size }, 'Full image: cache hit ✓ (no network request)');
        const url = URL.createObjectURL(cached);
        photosStore.setFull(id, url);
        return;
      }

      log.info({ id, camPath, attempt }, 'Full image: cache miss — fetching from camera');
      photosStore.setFullProgress(id, 0);
      const res = await fetch(`/api/fullres/${camPath}`);
      if (!res.ok || !res.body) {
        log.warn({ id, camPath, status: res.status, attempt }, 'Full image: fetch failed');
        photosStore.setFullProgress(id, null);
        if (attempt < DISPLAY_MAX_RETRIES && res.ok === false && (res.status === 503 || res.status === 502)) {
          const delay = DISPLAY_RETRY_DELAY_MS * (attempt + 1);
          await new Promise(r => setTimeout(r, delay));
          enqueueJob({ type: 'full', id, priority: P.FullNow });
        }
        return;
      }

      const contentLength = Number(res.headers.get('Content-Length') ?? 0);
      const sizeKb = contentLength ? `${Math.round(contentLength / 1024)}KB` : 'unknown size';
      log.info({ id, camPath, sizeKb }, 'Full image: downloading…');
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      let lastLoggedPct = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (contentLength > 0) {
          const pct = Math.round((received / contentLength) * 100);
          photosStore.setFullProgress(id, pct);
          // Log at 25% intervals
          if (pct >= lastLoggedPct + 25) {
            lastLoggedPct = Math.floor(pct / 25) * 25;
            log.debug({ id, pct, receivedKb: Math.round(received / 1024), sizeKb }, `Full image: ${pct}%`);
          }
        }
      }

      const blob = new Blob(chunks, { type: 'image/jpeg' });
      setCachedBlob(cacheKey, blob); // fire-and-forget — stored for next session
      const url = URL.createObjectURL(blob);
      photosStore.setFull(id, url);
      log.info({ id, camPath, bytes: received, kb: Math.round(received / 1024) }, 'Full image: loaded ✓ (cached for next session)');
    } catch (e) {
      log.warn({ err: e, id, camPath }, 'Full image: fetch threw');
      photosStore.setFullProgress(id, null);
    }
  }

  // ---------------------------------------------------------------------------
  // Idle prefetch — fetch display-quality images during inactivity (newest first)
  // ---------------------------------------------------------------------------
  let idlePrefetchTimer: ReturnType<typeof setTimeout> | null = null;
  const IDLE_DELAY_MS = 3_000; // wait 3s of inactivity before prefetching

  function scheduleIdlePrefetch() {
    if (idlePrefetchTimer) clearTimeout(idlePrefetchTimer);
    idlePrefetchTimer = setTimeout(runIdlePrefetch, IDLE_DELAY_MS);
  }

  function runIdlePrefetch() {
    // Enqueue display fetches for all thumbnail-only photos (newest first, lowest priority)
    const pending = photosStore.photos.filter(p =>
      p.thumbnailUrl && !p.fullUrl && p.fullProgress === null &&
      p.variants.some(v => /\.(jpe?g|cr3|cr2)$/i.test(v))
    );
    for (const photo of pending) {
      enqueueFull(photo.id, P.FullIdle);
    }
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  if (browser) {
    loadInitialState();
    startEventStream();
  }

  onDestroy(() => {
    eventSource?.close();
    eventSource = null;
  });
</script>

<div class="app">
  <StatusBar
    status={cameraStore.status}
    errorMessage={cameraStore.errorMessage}
    shotCount={photosStore.photos.length}
    cameraInfo={cameraInfoStore.info}
    shootingSettings={liveSettings}
    onconnection={() => (showSettings = true)}
    onclear={() => (showClear = true)}
  />
  <main class="content">
    <PhotoGrid photos={photosStore.photos} onopen={(i) => {
      lightboxIndex = i;
      const photo = photosStore.photos[i];
      // Urgent if newest photo (index 0), otherwise on-demand
      if (photo) enqueueFull(photo.id, i === 0 ? P.FullUrgent : P.FullNow);
    }} />
  </main>
</div>

{#if showSettings}
  <SettingsModal onclose={() => (showSettings = false)} />
{/if}

{#if showClear}
  <ConfirmClearModal
    photoCount={photosStore.photos.length}
    oncancel={() => (showClear = false)}
    onconfirm={async () => {
      showClear = false;
      lightboxIndex = null;
      await photosStore.clearAll();
      // Also wipe the image cache so stale blobs don't persist
      caches.delete(IMAGE_CACHE).catch(() => {});
    }}
  />
{/if}

{#if lightboxIndex !== null}
  <Lightbox
    photos={photosStore.photos}
    initialIndex={lightboxIndex}
    liveSettings={liveSettings}
    onclose={() => (lightboxIndex = null)}
    onfetchfull={(id) => {
      // Urgent if showing latest photo (index 0), on-demand otherwise
      const i = photosStore.photos.findIndex(p => p.id === id);
      enqueueFull(id, i === 0 ? P.FullUrgent : P.FullNow);
    }}
  />
{/if}

<style>
  :global(*, *::before, *::after) {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  :global(:root) {
    /* Accent colour palette — change these to retheme the entire app */
    --accent:        #6366f1; /* primary buttons, focus rings */
    --accent-dark:   #4f46e5; /* hover/pressed */
    --accent-light:  #818cf8; /* badge text, active labels */
    --accent-pale:   #a5b4fc; /* lightest hover text */
    --accent-rgb:    99, 102, 241; /* for rgba() usage */
    --accent-border: #334155; /* badge borders (slate-700) */
  }

  /* Light mode: switch to a yellow/gold accent palette */
  @media (prefers-color-scheme: light) {
    :global(:root) {
      --accent:        #ca8a04; /* yellow-600 */
      --accent-dark:   #a16207; /* yellow-700 */
      --accent-light:  #eab308; /* yellow-500 */
      --accent-pale:   #fde047; /* yellow-300 */
      --accent-rgb:    202, 138, 4;
      --accent-border: #713f12; /* yellow-900 */
    }
  }

  :global(html, body) {
    height: 100%;
    background: #0a0a0a;
    color: #e5e7eb;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    -webkit-font-smoothing: antialiased;
    overflow: hidden;
  }

  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }

  .content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .content::-webkit-scrollbar { width: 6px; }
  .content::-webkit-scrollbar-track { background: transparent; }
  .content::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
</style>
