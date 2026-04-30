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

  // Serial thumbnail fetch queue — one request at a time to avoid camera 503s
  type ThumbJob = { id: string; dirname: string; filename: string; priority: number };
  const thumbQueue: ThumbJob[] = [];
  let thumbRunning = false;

  async function enqueueThumbnail(id: string, dirname: string, filename: string) {
    // Priority: JPG=0 (higher), RAW=1 (lower)
    const priority = /\.(cr3|cr2)$/i.test(filename) ? 1 : 0;
    // Replace any existing lower-priority job for the same card
    const existing = thumbQueue.findIndex(j => j.id === id);
    if (existing !== -1) {
      if (thumbQueue[existing].priority <= priority) return; // already have equal/better
      thumbQueue.splice(existing, 1);
    }
    thumbQueue.push({ id, dirname, filename, priority });
    // Sort: JPG (0) before RAW (1)
    thumbQueue.sort((a, b) => a.priority - b.priority);
    processThumbQueue();
  }

  async function processThumbQueue() {
    if (thumbRunning) return;
    thumbRunning = true;
    while (thumbQueue.length > 0) {
      const job = thumbQueue.shift()!;
      // Skip if card already has a JPG thumbnail and this is a RAW job
      const card = photosStore.photos.find(p => p.id === job.id);
      if (job.priority === 1 && card?.thumbnailUrl) continue;
      await fetchThumbnail(job.id, job.dirname, job.filename);
    }
    thumbRunning = false;
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
  async function fetchThumbnail(id: string, dirname: string, filename: string) {
    const camPath = `${dirname}/${filename}`.replace(/^\//, '');
    try {
      const res = await fetch(`/api/thumbnail/${camPath}`);
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      photosStore.setThumbnail(id, url);
    } catch { /* silent */ }
  }

  // Fetch display-quality image (~340KB JPG) with progress tracking.
  // Only fetches JPG variants — skip if only RAW available.
  async function fetchDisplay(id: string) {
    const photo = photosStore.photos.find(p => p.id === id);
    if (!photo || photo.displayUrl) return; // already fetched

    // Find the JPG variant — display only works on JPG
    const jpgVariant = photo.variants.find(v => /\.jpe?g$/i.test(v));
    if (!jpgVariant) return;

    const camPath = `${photo.dirname}/${jpgVariant}`.replace(/^\//, '');
    try {
      photosStore.setDisplayProgress(id, 0);
      const res = await fetch(`/api/fullres/${camPath}`);
      if (!res.ok || !res.body) { photosStore.setDisplayProgress(id, 0); return; }

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
      // Start fetching display-quality image when lightbox opens
      const photo = photosStore.photos[i];
      if (photo) fetchDisplay(photo.id);
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
    onfetchdisplay={(id) => fetchDisplay(id)}
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
