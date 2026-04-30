<script lang="ts">
  import { onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { cameraStore } from '$lib/stores/camera.svelte';
  import { photosStore } from '$lib/stores/photos.svelte';
  import { cameraInfoStore } from '$lib/stores/cameraInfo.svelte';
  import StatusBar from '$lib/components/StatusBar.svelte';
  import CameraConfig from '$lib/components/CameraConfig.svelte';
  import PhotoGrid from '$lib/components/PhotoGrid.svelte';

  let eventSource: EventSource | null = null;

  async function fetchCameraInfo() {
    try {
      const res = await fetch('/api/camera/info');
      if (res.ok) {
        const info = await res.json();
        cameraInfoStore.set(info);
      }
    } catch {
      // non-fatal — status bar will show generic Live label
    }
  }

  function connect() {
    if (!browser || eventSource) return;
    cameraStore.setStatus('connecting');
    cameraInfoStore.set(null);

    eventSource = new EventSource('/api/events');

    eventSource.addEventListener('status', (e) => {
      const data = JSON.parse(e.data) as { status: string; error?: string };
      if (data.status === 'live') {
        cameraStore.setStatus('live');
        // Fetch full camera details once on connect (storage, serial, firmware)
        if (!cameraInfoStore.info) fetchCameraInfo();
      } else if (data.status === 'reconnecting') {
        cameraStore.setStatus('reconnecting', data.error);
      } else if (data.status === 'connecting') {
        cameraStore.setStatus('connecting');
      }
    });

    eventSource.addEventListener('info', (e) => {
      const update = JSON.parse(e.data) as {
        battery?: { level: string; quality: string; name: string };
      };
      const current = cameraInfoStore.info;
      if (!current) return;
      cameraInfoStore.set({
        ...current,
        battery: update.battery ?? current.battery,
      });
    });

    eventSource.addEventListener('shot', (e) => {
      // path = "/ccapi/ver120/contents/card1/100EOSR6/4E5A8395.JPG"
      const { path } = JSON.parse(e.data) as { path: string };
      const parts = path.split('/');
      const filename = parts.pop()!;
      const dirname = parts.join('/');
      const id = photosStore.addOrMerge(dirname, filename);
      // Only fetch thumbnail for JPG — RAW thumbnails use same endpoint
      // but we prefer the JPG variant if available (fetched when JPG arrives)
      const isRaw = /\.(cr3|cr2)$/i.test(filename);
      if (!isRaw || !photosStore.photos.find(p => p.id === id)?.thumbnailUrl) {
        fetchThumbnail(id, dirname, filename);
      }
    });

    eventSource.onerror = () => {
      cameraStore.setStatus('reconnecting');
      // EventSource reconnects automatically
    };
  }

  async function disconnect() {
    if (!browser) return;
    // Tell the server to immediately release the camera's polling slot.
    fetch('/api/events', { method: 'DELETE', signal: AbortSignal.timeout(5_000) }).catch(() => {});
    eventSource?.close();
    eventSource = null;
    cameraStore.setStatus('idle');
    cameraInfoStore.set(null);
  }

  async function fetchThumbnail(id: string, dirname: string, filename: string) {
    // dirname looks like /ccapi/ver120/contents/card1/100EOSR6
    // Strip leading / so it becomes the [...path] param for our API routes
    const camPath = `${dirname}/${filename}`.replace(/^\//, '');
    try {
      const res = await fetch(`/api/thumbnail/${camPath}`);
      if (!res.ok) return;
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      photosStore.setThumbnail(id, objectUrl);
      // Mark as fullres too — we only have thumbnails for now
      photosStore.setFullres(id, objectUrl);
    } catch {
      // silent — card stays in loading state
    }
  }

  onDestroy(() => {
    disconnect();
  });
</script>

<div class="app">
  <StatusBar
    status={cameraStore.status}
    errorMessage={cameraStore.errorMessage}
    shotCount={photosStore.photos.length}
    cameraInfo={cameraInfoStore.info}
  />
  <CameraConfig onconnect={connect} ondisconnect={disconnect} />
  <main class="content">
    <PhotoGrid photos={photosStore.photos} />
  </main>
</div>

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

  /* Scrollbar styling */
  .content::-webkit-scrollbar {
    width: 6px;
  }
  .content::-webkit-scrollbar-track {
    background: transparent;
  }
  .content::-webkit-scrollbar-thumb {
    background: #333;
    border-radius: 3px;
  }
</style>
