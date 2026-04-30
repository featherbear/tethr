<script lang="ts">
  import { onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { cameraStore } from '$lib/stores/camera.svelte';
  import { photosStore } from '$lib/stores/photos.svelte';
  import { cameraInfoStore } from '$lib/stores/cameraInfo.svelte';
  import StatusBar from '$lib/components/StatusBar.svelte';
  import PhotoGrid from '$lib/components/PhotoGrid.svelte';
  import SettingsModal from '$lib/components/SettingsModal.svelte';

  let eventSource: EventSource | null = null;
  let showSettings = $state(false);

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

    eventSource.addEventListener('shot', (e) => {
      const { path } = JSON.parse(e.data) as { path: string };
      const parts = path.split('/');
      const filename = parts.pop()!;
      const dirname = parts.join('/');
      const id = photosStore.addOrMerge(dirname, filename);
      const isRaw = /\.(cr3|cr2)$/i.test(filename);
      if (!isRaw || !photosStore.photos.find(p => p.id === id)?.thumbnailUrl) {
        fetchThumbnail(id, dirname, filename);
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
  async function fetchThumbnail(id: string, dirname: string, filename: string) {
    const camPath = `${dirname}/${filename}`.replace(/^\//, '');
    try {
      const res = await fetch(`/api/thumbnail/${camPath}`);
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      photosStore.setThumbnail(id, url);
      photosStore.setFullres(id, url);
    } catch { /* silent */ }
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
    onsettings={() => (showSettings = true)}
  />
  <main class="content">
    <PhotoGrid photos={photosStore.photos} />
  </main>
</div>

{#if showSettings}
  <SettingsModal onclose={() => (showSettings = false)} />
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
