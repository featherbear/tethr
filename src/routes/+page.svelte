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
  import Lightbox from '$lib/components/Lightbox.svelte';

  let eventSource: EventSource | null = null;
  let showSettings = $state(false);
  let lightboxIndex = $state<number | null>(null);
  let liveSettings = $state<ShootingSettings | null>(null);

  // ---------------------------------------------------------------------------
  // Single global serial camera fetch queue — CCAPI is single-threaded,
  // all camera requests (thumbnail + display) must be serialised.
  // ---------------------------------------------------------------------------
  const P = {
    Thumbnail:    0,  // urgent — JPG thumbnail for new shot
    ThumbnailRaw: 1,  // urgent — RAW thumbnail (fallback if no JPG)
    DisplayNow:   2,  // on-demand — lightbox open / navigate
    DisplayIdle:  3,  // background — idle prefetch
  } as const;
  type PValue = typeof P[keyof typeof P];

  type Job =
    | { type: 'thumb';   id: string; dirname: string; filename: string; priority: PValue }
    | { type: 'display'; id: string; priority: PValue };

  const fetchQueue: Job[] = [];
  let fetchRunning = false;

  function enqueueJob(job: Job) {
    // For thumbnail jobs: replace existing lower-priority job for same id
    if (job.type === 'thumb') {
      const existing = fetchQueue.findIndex(j => j.type === 'thumb' && j.id === job.id);
      if (existing !== -1) {
        if ((fetchQueue[existing] as typeof job).priority <= job.priority) return;
        fetchQueue.splice(existing, 1);
      }
    }
    // For display jobs: skip if already queued or loaded
    if (job.type === 'display') {
      const photo = photosStore.photos.find(p => p.id === job.id);
      if (!photo || photo.displayUrl || photo.displayProgress !== null) return;
      if (fetchQueue.some(j => j.type === 'display' && j.id === job.id)) return;
    }
    fetchQueue.push(job);
    fetchQueue.sort((a, b) => a.priority - b.priority);
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
        await fetchDisplay(job.id);
      }
    }
    fetchRunning = false;
  }

  function enqueueThumbnail(id: string, dirname: string, filename: string) {
    const priority = /\.(cr3|cr2)$/i.test(filename) ? P.ThumbnailRaw : P.Thumbnail;
    enqueueJob({ type: 'thumb', id, dirname, filename, priority });
  }

  function enqueueDisplay(id: string, priority: typeof P.DisplayNow | typeof P.DisplayIdle) {
    enqueueJob({ type: 'display', id, priority });
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
      cameraStore.setStatus(status, error ?? undefined);
      if (cameraInfo) cameraInfoStore.set(cameraInfo);
    } catch { /* non-fatal */ }
  }

  // ---------------------------------------------------------------------------
  // SSE subscription
  // ---------------------------------------------------------------------------
  function startEventStream() {
    if (!browser || eventSource) return;
    eventSource = new EventSource('/api/events');

    eventSource.addEventListener('status', (e) => {
      const { status, error } = JSON.parse(e.data);
      cameraStore.setStatus(status, error);
      // Fetch camera info when we first go live
      if (status === 'live' && !cameraInfoStore.info) {
        fetchCameraInfo();
      }
      // Clear info when disconnected
      if (status === 'stopped' || status === 'connecting') {
        cameraInfoStore.set(null);
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
      const id = photosStore.addOrMerge(dirname, filename, settings);
      enqueueThumbnail(id, dirname, filename);
      // Cancel idle prefetch timer and flush pending display jobs — camera is active
      if (idlePrefetchTimer) { clearTimeout(idlePrefetchTimer); idlePrefetchTimer = null; }
      // Remove queued idle display jobs — leave on-demand display and thumbnails
      for (let i = fetchQueue.length - 1; i >= 0; i--) {
        if (fetchQueue[i].type === 'display' && fetchQueue[i].priority === P.DisplayIdle) {
          fetchQueue.splice(i, 1);
        }
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

  async function fetchThumbnail(id: string, dirname: string, filename: string, attempt = 0) {
    const camPath = `${dirname}/${filename}`.replace(/^\//, '');
    try {
      const res = await fetch(`/api/thumbnail/${camPath}`);
      if (!res.ok) {
        // Retry on transient camera errors (503, 502) with backoff
        if (attempt < THUMB_MAX_RETRIES && (res.status === 503 || res.status === 502)) {
          const delay = THUMB_RETRY_DELAY_MS * (attempt + 1);
          await new Promise(r => setTimeout(r, delay));
          // Re-enqueue at same priority so it goes through the serial queue
          enqueueJob({ type: 'thumb', id, dirname, filename, priority: P.Thumbnail });
        }
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      photosStore.setThumbnail(id, url);
      // Schedule idle prefetch after thumbnail is ready
      scheduleIdlePrefetch();
    } catch { /* silent */ }
  }

  const DISPLAY_MAX_RETRIES = 3;
  const DISPLAY_RETRY_DELAY_MS = 2_000;

  // Fetch display-quality image (~340KB JPG) with progress tracking.
  // Only fetches JPG variants — skip if only RAW available.
  async function fetchDisplay(id: string, attempt = 0) {
    const photo = photosStore.photos.find(p => p.id === id);
    if (!photo || photo.displayUrl) return; // already fetched

    // Prefer JPG variant, fall back to CR3/CR2 — camera serves display JPEG from RAW too
    const displayVariant = photo.variants.find(v => /\.jpe?g$/i.test(v))
                        ?? photo.variants.find(v => /\.(cr3|cr2)$/i.test(v));
    if (!displayVariant) return;

    const camPath = `${photo.dirname}/${displayVariant}`.replace(/^\//, '');
    try {
      photosStore.setDisplayProgress(id, 0);
      const res = await fetch(`/api/fullres/${camPath}`);
      if (!res.ok || !res.body) {
        photosStore.setDisplayProgress(id, 0);
        // Retry on transient errors
        if (attempt < DISPLAY_MAX_RETRIES && res.ok === false && (res.status === 503 || res.status === 502)) {
          const delay = DISPLAY_RETRY_DELAY_MS * (attempt + 1);
          await new Promise(r => setTimeout(r, delay));
          enqueueJob({ type: 'display', id, priority: P.DisplayNow });
        }
        return;
      }

      const contentLength = Number(res.headers.get('Content-Length') ?? 0);
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (contentLength > 0) {
          photosStore.setDisplayProgress(id, Math.round((received / contentLength) * 100));
        }
      }

      const blob = new Blob(chunks, { type: 'image/jpeg' });
      const url = URL.createObjectURL(blob);
      photosStore.setDisplay(id, url);
    } catch { photosStore.setDisplayProgress(id, 0); }
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
      p.thumbnailUrl && !p.displayUrl && p.displayProgress === null &&
      p.variants.some(v => /\.jpe?g$/i.test(v))
    );
    for (const photo of pending) {
      enqueueDisplay(photo.id, P.DisplayIdle);
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
    onsettings={() => (showSettings = true)}
  />
  <main class="content">
    <PhotoGrid photos={photosStore.photos} onopen={(i) => {
      lightboxIndex = i;
      // On-demand: priority 1 (ahead of idle prefetch)
      const photo = photosStore.photos[i];
      if (photo) enqueueDisplay(photo.id, P.DisplayNow);
    }} />
  </main>
</div>

{#if showSettings}
  <SettingsModal onclose={() => (showSettings = false)} />
{/if}

{#if lightboxIndex !== null}
  <Lightbox
    photos={photosStore.photos}
    initialIndex={lightboxIndex}
    liveSettings={liveSettings}
    onclose={() => (lightboxIndex = null)}
    onfetchdisplay={(id) => enqueueDisplay(id, P.DisplayNow)}
  />
{/if}

<style>
  :global(*, *::before, *::after) {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
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
