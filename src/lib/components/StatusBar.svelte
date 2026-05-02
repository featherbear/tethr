<script lang="ts">
  import type { ConnectionStatus } from '$lib/stores/camera.svelte';
  import type { CameraInfo } from '$lib/stores/cameraInfo.svelte';
  import type { ShootingSettings } from '$lib/stores/photos.svelte';
  import { formatExposure } from '$lib/formatters';

  interface Props {
    status: ConnectionStatus;
    errorMessage?: string | null;
    shotCount?: number;
    cameraInfo?: CameraInfo | null;
    shootingSettings?: ShootingSettings | null;
    onsettings?: () => void;
  }

  const { status, errorMessage = null, shotCount = 0, cameraInfo = null, shootingSettings = null, onsettings }: Props = $props();

  const DRIVE_LABELS: Record<string, string> = {
    cont_super_hi: 'BURST HI+',
    highspeed:     'BURST HI',
    lowspeed:      'BURST LO',
    self_10sec:    'SELF 10s',
    self_2sec:     'SELF 2s',
    self_continuous: 'SELF CONT',
  };
  function driveLabel(d: string): string { return DRIVE_LABELS[d] ?? d.toUpperCase(); }

  const statusConfig: Record<ConnectionStatus, { label: string; color: string }> = {
    idle:         { label: 'Idle',         color: '#6b7280' },
    connecting:   { label: 'Connecting…',  color: '#f59e0b' },
    live:         { label: 'Live',         color: '#22c55e' },
    reconnecting: { label: 'Reconnecting…',color: '#f59e0b' },
    error:        { label: 'Error',        color: '#ef4444' },
    stopped:      { label: 'Stopped',      color: '#6b7280' },
  };

  const cfg = $derived(statusConfig[status] ?? statusConfig.idle);

  // Battery level → fill fraction (0–1) and colour.
  // batterylist (ver110) returns numeric strings like "14" (percentage).
  // battery (ver100) returns named strings like "low".
  // Full named enum from Canon SDK: 'full' | 'high' | 'half' | 'quarter' | 'low' |
  //   'exhausted' | 'charge' | 'chargestop' | 'chargecomp' | 'none' | 'unknown'
  function batteryFill(level: string): number {
    const pct = parseInt(level, 10);
    if (!isNaN(pct)) return pct / 100; // numeric % from batterylist
    switch (level) {
      case 'full':        return 1.0;
      case 'high':        return 0.75;
      case 'half':        return 0.5;
      case 'quarter':     return 0.25;
      case 'low':         return 0.1;
      case 'exhausted':   return 0.05;
      case 'charge':      return 0.5;
      case 'chargestop':  return 0.5;
      case 'chargecomp':  return 1.0;
      default:            return 0;
    }
  }

  function batteryColor(level: string): string {
    const pct = parseInt(level, 10);
    if (!isNaN(pct)) {
      if (pct > 50) return '#22c55e';
      if (pct > 25) return '#f59e0b';
      if (pct > 10) return '#f97316';
      return '#ef4444';
    }
    switch (level) {
      case 'full':
      case 'high':
      case 'chargecomp': return '#22c55e';
      case 'half':
      case 'charge':
      case 'chargestop': return '#f59e0b';
      case 'quarter':    return '#f97316';
      case 'low':
      case 'exhausted':  return '#ef4444';
      default:           return '#6b7280';
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
      <!-- Model + serial -->
      <span class="model">{cameraInfo.productname}</span>
      <span class="serial">{cameraInfo.serialnumber}</span>

      {#if cameraInfo.lens}
        <span class="sep">·</span>
        <span class="lens">{cameraInfo.lens}</span>
      {/if}

      {#if shootingSettings?.av || shootingSettings?.tv || shootingSettings?.iso}
        <span class="sep">·</span>
        <div class="shooting">
          {#if shootingSettings.av}<span class="setting">{shootingSettings.av}</span>{/if}
          {#if shootingSettings.tv}<span class="setting">{shootingSettings.tv}</span>{/if}
          {#if shootingSettings.iso}<span class="setting">ISO {shootingSettings.iso}</span>{/if}
          {#if formatExposure(shootingSettings.exposure)}<span class="setting exp">{formatExposure(shootingSettings.exposure)}</span>{/if}
          {#if shootingSettings.drive && shootingSettings.drive !== 'single'}<span class="setting drive">{driveLabel(shootingSettings.drive)}</span>{/if}
        </div>
      {/if}

    {:else}
      <span class="status-label">{cfg.label}</span>
      {#if errorMessage && status === 'error'}
        <span class="error-msg">{errorMessage}</span>
      {/if}
    {/if}
  </div>

  <!-- Right: battery + shot count + fullscreen + settings -->
  <div class="right">
    {#if cameraInfo}
      <div class="battery-wrap" title="Battery: {
        (() => { const p = parseInt(cameraInfo.battery.level, 10); return isNaN(p) ? cameraInfo.battery.level : p + '%'; })()
      } ({cameraInfo.battery.name})">
        <svg class="battery-icon" viewBox="0 0 24 12" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <rect x="0.5" y="0.5" width="20" height="11" rx="2" ry="2"
            fill="none" stroke="currentColor" stroke-width="1"/>
          <rect x="20.5" y="3.5" width="3" height="5" rx="1" ry="1" fill="currentColor"/>
          <rect x="2" y="2" width="{fill * 16}" height="8" rx="1" ry="1"
            fill={bColor}/>
        </svg>
      </div>
    {/if}
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
    <button class="icon-btn" onclick={onsettings} title="Camera connection" aria-label="Camera connection">
      <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <!-- Left link -->
        <rect x="1" y="5.5" width="5.5" height="5" rx="2.5" stroke="currentColor" stroke-width="1.5"/>
        <!-- Right link -->
        <rect x="9.5" y="5.5" width="5.5" height="5" rx="2.5" stroke="currentColor" stroke-width="1.5"/>
        <!-- Connecting bar -->
        <line x1="6.5" y1="8" x2="9.5" y2="8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
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

  .model {
    font-weight: 600;
    color: #e5e7eb;
    white-space: nowrap;
  }

  .serial {
    font-family: monospace;
    font-size: 0.7rem;
    color: #4b5563;
    white-space: nowrap;
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


  /* Lens */
  .lens {
    color: #6b7280;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  /* Live shooting settings */
  .shooting {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-shrink: 0;
  }

  .setting {
    color: #e5e7eb;
    font-weight: 500;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
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
