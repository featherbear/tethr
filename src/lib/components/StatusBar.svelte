<script lang="ts">
  import type { ConnectionStatus } from '$lib/stores/camera.svelte';
  import type { CameraInfo } from '$lib/stores/cameraInfo.svelte';
  import { formatBytes, batteryColor } from '$lib/stores/cameraInfo.svelte';

  interface Props {
    status: ConnectionStatus;
    errorMessage?: string | null;
    shotCount?: number;
    cameraInfo?: CameraInfo | null;
    onsettings?: () => void;
  }

  const { status, errorMessage = null, shotCount = 0, cameraInfo = null, onsettings }: Props = $props();

  const statusConfig: Record<ConnectionStatus, { label: string; color: string }> = {
    idle:         { label: 'Idle',         color: '#6b7280' },
    connecting:   { label: 'Connecting…',  color: '#f59e0b' },
    live:         { label: 'Live',         color: '#22c55e' },
    reconnecting: { label: 'Reconnecting…',color: '#f59e0b' },
    error:        { label: 'Error',        color: '#ef4444' },
  };

  const cfg = $derived(statusConfig[status]);

  let isFullscreen = $state(false);

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      isFullscreen = true;
    } else {
      document.exitFullscreen().catch(() => {});
      isFullscreen = false;
    }
  }

  function handleFullscreenChange() {
    isFullscreen = !!document.fullscreenElement;
  }

  const usedBytes   = $derived(cameraInfo?.storage ? cameraInfo.storage.maxsize - cameraInfo.storage.spacesize : 0);
  const usedPercent = $derived(cameraInfo?.storage ? Math.round((usedBytes / cameraInfo.storage.maxsize) * 100) : 0);
  const freeStr     = $derived(cameraInfo?.storage ? formatBytes(cameraInfo.storage.spacesize) : '');
</script>

<svelte:window onfullscreenchange={handleFullscreenChange} />

<div class="status-bar">
  <!-- Left: connection status -->
  <div class="left">
    <span class="dot" style:background={cfg.color} class:pulse={status === 'live'}></span>

    {#if status === 'live' && cameraInfo}
      <span class="model" title="S/N {cameraInfo.serialnumber} · FW {cameraInfo.firmwareversion}">{cameraInfo.productname}</span>
      <span class="sep">·</span>
      <!-- Battery -->
      <span class="battery" style:color={batteryColor(cameraInfo.battery.level)}>
        ⬡ {cameraInfo.battery.level}
      </span>
      <span class="sep">·</span>
      <!-- Card space -->
      <span class="storage">
        💾 {freeStr} free · {cameraInfo.storage?.contentsnumber ?? 0} files
      </span>
      {#if usedPercent > 0}
        <span class="sep">·</span>
        <div class="storage-bar">
          <div class="storage-bar__fill" style:width="{usedPercent}%"></div>
        </div>
      {/if}
    {:else}
      <span class="label">{cfg.label}</span>
      {#if errorMessage && (status === 'error' || status === 'reconnecting')}
        <span class="error-msg">{errorMessage}</span>
      {/if}
    {/if}
  </div>

  <!-- Right: shot counter + settings -->
  <div class="right">
    {#if shotCount > 0}
      <span class="shot-count">{shotCount} {shotCount === 1 ? 'photo' : 'photos'}</span>
    {/if}
    <button class="fullscreen-btn" onclick={toggleFullscreen} title="Fullscreen (F)" aria-label="Toggle fullscreen">
      {isFullscreen ? '⛶' : '⛶'}
    </button>
    <button class="settings-btn" onclick={onsettings} title="Camera settings" aria-label="Camera settings">
      ⚙
    </button>
  </div>
</div>

<style>
  .status-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 1.25rem;
    background: #111;
    border-bottom: 1px solid #222;
    font-size: 0.8rem;
    color: #9ca3af;
    user-select: none;
    min-height: 36px;
  }

  .left {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    overflow: hidden;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .dot.pulse {
    animation: pulse 2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.4; }
  }

  .label {
    font-weight: 500;
    color: #e5e7eb;
  }

  .model {
    font-weight: 600;
    color: #e5e7eb;
    white-space: nowrap;
    cursor: help;
    border-bottom: 1px dotted #444;
  }

  .sep {
    color: #374151;
  }

  .battery {
    font-weight: 500;
    white-space: nowrap;
    text-transform: capitalize;
  }

  .storage {
    white-space: nowrap;
    color: #9ca3af;
  }

  .storage-bar {
    width: 60px;
    height: 4px;
    background: #2a2a2a;
    border-radius: 2px;
    overflow: hidden;
    flex-shrink: 0;
  }

  .storage-bar__fill {
    height: 100%;
    background: #6366f1;
    border-radius: 2px;
    transition: width 0.3s ease;
  }

  .error-msg {
    color: #ef4444;
    font-size: 0.75rem;
    max-width: 350px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .right {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-shrink: 0;
  }

  .shot-count {
    color: #6b7280;
  }

  .fullscreen-btn,
  .settings-btn {
    background: none;
    border: none;
    color: #4b5563;
    font-size: 1rem;
    cursor: pointer;
    padding: 0.1rem 0.25rem;
    line-height: 1;
    transition: color 0.15s;
    border-radius: 4px;
  }

  .fullscreen-btn:hover,
  .settings-btn:hover {
    color: #9ca3af;
    background: #1f1f1f;
  }
</style>
