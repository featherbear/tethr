<script lang="ts">
  import type { ConnectionStatus } from '$lib/stores/camera.svelte';
  import type { CameraInfo } from '$lib/stores/cameraInfo.svelte';

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
    stopped:      { label: 'Stopped',      color: '#6b7280' },
  };

  const cfg = $derived(statusConfig[status] ?? statusConfig.idle);

  // Battery level → fill fraction (0–1) and colour
  function batteryFill(level: string): number {
    switch (level) {
      case 'high':      return 1.0;
      case 'half':      return 0.5;
      case 'low':       return 0.2;
      case 'exhausted': return 0.05;
      default:          return 0;
    }
  }

  function batteryColor(level: string): string {
    switch (level) {
      case 'high': return '#22c55e';
      case 'half': return '#f59e0b';
      case 'low':  return '#ef4444';
      default:     return '#6b7280';
    }
  }

  const fill  = $derived(cameraInfo ? batteryFill(cameraInfo.battery.level) : 0);
  const bColor = $derived(cameraInfo ? batteryColor(cameraInfo.battery.level) : '#6b7280');

  // Fullscreen
  let isFullscreen = $state(false);

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  function handleFullscreenChange() {
    isFullscreen = !!document.fullscreenElement;
  }
</script>

<svelte:window onfullscreenchange={handleFullscreenChange} />

<div class="status-bar">
  <!-- Left: status dot + camera details -->
  <div class="left">
    <span class="dot" style:background={cfg.color} class:pulse={status === 'live'}></span>

    {#if status === 'live' && cameraInfo}
      <!-- Model with serial number popover -->
      <div class="model-wrap">
        <span class="model">{cameraInfo.productname}</span>
        <div class="popover">
          <div class="popover__row">
            <span class="popover__label">Serial</span>
            <span class="popover__value">{cameraInfo.serialnumber}</span>
          </div>
          <div class="popover__row">
            <span class="popover__label">Firmware</span>
            <span class="popover__value">{cameraInfo.firmwareversion}</span>
          </div>
          <div class="popover__row">
            <span class="popover__label">Battery</span>
            <span class="popover__value">{cameraInfo.battery.name}</span>
          </div>
        </div>
      </div>

      <span class="sep">·</span>

      <!-- Graphical battery -->
      <div class="battery-wrap" title="Battery: {cameraInfo.battery.level}">
        <svg class="battery-icon" viewBox="0 0 24 12" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <!-- Battery body -->
          <rect x="0.5" y="0.5" width="20" height="11" rx="2" ry="2"
            fill="none" stroke="currentColor" stroke-width="1"/>
          <!-- Battery terminal nub -->
          <rect x="20.5" y="3.5" width="3" height="5" rx="1" ry="1" fill="currentColor"/>
          <!-- Fill bar -->
          <rect x="2" y="2" width="{fill * 16}" height="8" rx="1" ry="1"
            fill={bColor}/>
        </svg>
        <span class="battery-label" style:color={bColor}>{cameraInfo.battery.level}</span>
      </div>

      {#if cameraInfo.lens}
        <span class="sep">·</span>
        <span class="lens">{cameraInfo.lens}</span>
      {/if}

    {:else}
      <span class="status-label">{cfg.label}</span>
      {#if errorMessage && (status === 'error' || status === 'reconnecting')}
        <span class="error-msg">{errorMessage}</span>
      {/if}
    {/if}
  </div>

  <!-- Right: shot count + fullscreen + settings -->
  <div class="right">
    {#if shotCount > 0}
      <span class="shot-count">{shotCount} {shotCount === 1 ? 'photo' : 'photos'}</span>
    {/if}
    <button class="icon-btn" onclick={toggleFullscreen} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'} aria-label="Toggle fullscreen">
      {#if isFullscreen}
        <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M5.5 1.5V5.5H1.5M10.5 1.5V5.5H14.5M5.5 14.5V10.5H1.5M10.5 14.5V10.5H14.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      {:else}
        <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M1.5 5.5V1.5H5.5M14.5 5.5V1.5H10.5M1.5 10.5V14.5H5.5M14.5 10.5V14.5H10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      {/if}
    </button>
    <button class="icon-btn" onclick={onsettings} title="Camera settings" aria-label="Camera settings">
      <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="8" cy="8" r="2.5" stroke="currentColor" stroke-width="1.5"/>
        <path d="M8 1v2M8 13v2M1 8h2M13 8h2M2.93 2.93l1.41 1.41M11.66 11.66l1.41 1.41M2.93 13.07l1.41-1.41M11.66 4.34l1.41-1.41" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
    </button>
  </div>
</div>

<style>
  .status-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 1rem;
    background: #111;
    border-bottom: 1px solid #1e1e1e;
    font-size: 0.775rem;
    color: #9ca3af;
    user-select: none;
    height: 38px;
    flex-shrink: 0;
    gap: 1rem;
  }

  .left {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    overflow: hidden;
    min-width: 0;
  }

  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .dot.pulse { animation: pulse 2s ease-in-out infinite; }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.35; }
  }

  .sep { color: #2a2a2a; flex-shrink: 0; }

  .status-label { color: #e5e7eb; font-weight: 500; }

  .error-msg {
    color: #ef4444;
    font-size: 0.7rem;
    max-width: 320px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Model + serial popover */
  .model-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }

  .model {
    font-weight: 600;
    color: #e5e7eb;
    white-space: nowrap;
    cursor: default;
  }

  .popover {
    display: none;
    position: absolute;
    top: calc(100% + 8px);
    left: 0;
    background: #1a1a1a;
    border: 1px solid #2a2a2a;
    border-radius: 8px;
    padding: 0.6rem 0.85rem;
    box-shadow: 0 8px 24px rgba(0,0,0,0.5);
    z-index: 50;
    min-width: 200px;
    flex-direction: column;
    gap: 0.35rem;
    white-space: nowrap;
  }

  .model-wrap:hover .popover {
    display: flex;
  }

  .popover__row {
    display: flex;
    gap: 0.75rem;
    align-items: baseline;
  }

  .popover__label {
    font-size: 0.65rem;
    color: #4b5563;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    width: 56px;
    flex-shrink: 0;
  }

  .popover__value {
    font-size: 0.75rem;
    color: #d1d5db;
    font-family: monospace;
  }

  /* Battery */
  .battery-wrap {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-shrink: 0;
  }

  .battery-icon {
    width: 22px;
    height: 11px;
    color: #4b5563;
  }

  .battery-label {
    font-size: 0.7rem;
    font-weight: 500;
    text-transform: capitalize;
  }

  /* Lens */
  .lens {
    color: #6b7280;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  /* Right side */
  .right {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
  }

  .shot-count { color: #4b5563; font-size: 0.7rem; }

  .icon-btn {
    background: none;
    border: none;
    color: #4b5563;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    border-radius: 5px;
    transition: color 0.15s, background 0.15s;
    padding: 0;
    flex-shrink: 0;
  }

  .icon-btn svg { width: 14px; height: 14px; }

  .icon-btn:hover {
    color: #9ca3af;
    background: #1a1a1a;
  }
</style>
