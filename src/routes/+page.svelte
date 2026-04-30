<script lang="ts">
  import { onDestroy } from 'svelte';
  import { cameraStore } from '$lib/stores/camera.svelte';
  import { photosStore } from '$lib/stores/photos.svelte';
  import StatusBar from '$lib/components/StatusBar.svelte';
  import CameraConfig from '$lib/components/CameraConfig.svelte';
  import PhotoGrid from '$lib/components/PhotoGrid.svelte';

  let eventSource: EventSource | null = null;
  // Queue of photo IDs waiting for full-res fetch, newest first
  let fullresQueue: string[] = [];
  let fetchingFullres = false;

  function connect() {
    if (eventSource) return;
    cameraStore.setStatus('connecting');

    eventSource = new EventSource('/api/events');

    eventSource.addEventListener('status', (e) => {
      const data = JSON.parse(e.data) as { status: string; error?: string };
      if (data.status === 'live') {
        cameraStore.setStatus('live');
      } else if (data.status === 'reconnecting') {
        cameraStore.setStatus('reconnecting', data.error);
      } else if (data.status === 'connecting') {
        cameraStore.setStatus('connecting');
      }
    });

    eventSource.addEventListener('shot', (e) => {
      const shot = JSON.parse(e.data) as {
        storagegen: string;
        dirname: string;
        filename: string;
      };
      const id = photosStore.addPlaceholder(shot.dirname, shot.filename);
      fetchThumbnail(id, shot.dirname, shot.filename);
    });

    eventSource.onerror = () => {
      cameraStore.setStatus('reconnecting');
      // EventSource reconnects automatically
    };
  }

  function disconnect() {
    eventSource?.close();
    eventSource = null;
    cameraStore.setStatus('idle');
    fullresQueue = [];
  }

  async function fetchThumbnail(id: string, dirname: string, filename: string) {
    // dirname looks like /ccapi/ver100/contents/storage1/card1/100CANON
    // We need to pass it as the [...path] param, stripping the leading /
    const camPath = `${dirname}/${filename}`.replace(/^\//, '');
    try {
      const url = `/api/thumbnail/${camPath}`;
      // Create an object URL from the blob
      const res = await fetch(url);
      if (!res.ok) return;
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      photosStore.setThumbnail(id, objectUrl);
      // Enqueue full-res fetch (newest first — already prepended)
      fullresQueue.unshift(id + '|' + camPath);
      processFullresQueue();
    } catch {
      // silent — card stays in loading state
    }
  }

  async function processFullresQueue() {
    if (fetchingFullres || fullresQueue.length === 0) return;
    fetchingFullres = true;
    while (fullresQueue.length > 0) {
      const entry = fullresQueue.shift()!;
      const [id, camPath] = entry.split('|');
      try {
        const res = await fetch(`/api/fullres/${camPath}`);
        if (res.ok) {
          const blob = await res.blob();
          const objectUrl = URL.createObjectURL(blob);
          photosStore.setFullres(id, objectUrl);
        }
      } catch {
        // silent
      }
    }
    fetchingFullres = false;
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
