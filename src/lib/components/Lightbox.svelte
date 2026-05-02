<script lang="ts">
  import { fade } from 'svelte/transition';
  import { untrack } from 'svelte';
  import type { Photo, ShootingSettings } from '$lib/stores/photos.svelte';
  import { formatExposure } from '$lib/formatters';

  interface Props {
    photos: Photo[];
    initialIndex: number;
    liveSettings?: ShootingSettings | null;
    onclose: () => void;
    onfetchdisplay?: (id: string) => void;
  }

  const { photos, initialIndex, liveSettings = null, onclose, onfetchdisplay }: Props = $props();

  let latestMode = $state(false);
  let isFullscreen = $state(false);

  // Display controls
  let showControls = $state(false);
  let curvedCorners = $state(true);
  let ambientEnabled = $state(true);
  let shadowEnabled = $state(true);

  // Track viewed photo by ID (stable across array prepends)
  let currentId = $state(untrack(() => photos[initialIndex]?.id ?? null));

  const index = $derived.by(() => {
    if (latestMode) return 0;
    const i = photos.findIndex(p => p.id === currentId);
    return i === -1 ? 0 : i;
  });

  const photo = $derived(photos[index] ?? null);

  // ---------------------------------------------------------------------------
  // Image display state machine
  //
  // shownUrl  — the image currently visible (bg layer, always rendered if set)
  // fadingUrl — the image fading in on top (null when no transition in progress)
  // shimmer   — true while waiting for a better image to load
  //
  // Transitions:
  //   1. Photo changes (navigate / new shot in latest mode):
  //      shownUrl stays as crossfade source; fadingUrl = null; shimmer = true
  //      → when target image loads: fadingUrl = newUrl; shimmer = false
  //      → onintroend: shownUrl = fadingUrl; fadingUrl = null
  //
  //   2. Same photo, display loads after thumbnail:
  //      fadingUrl = displayUrl; shimmer = false
  //      → onintroend: shownUrl = displayUrl; fadingUrl = null
  // ---------------------------------------------------------------------------
  // shownUrl: the image currently visible (crossfade source/background)
  // Starts as best available for opening photo; updated via onintroend
  let shownUrl = $state<string | null>(
    untrack(() => { const p = photos[initialIndex]; return p?.displayUrl ?? p?.thumbnailUrl ?? null; })
  );

  // Track processed photo id to detect photo changes
  let processedId = $state<string | null>(untrack(() => photos[initialIndex]?.id ?? null));

  // Request display fetch when needed (on mount and photo change)
  $effect(() => {
    if (!photo) return;
    const id = photo.id;
    if (id !== processedId) processedId = id;
    if (!photo.displayUrl && photo.displayProgress === null) {
      onfetchdisplay?.(id);
    }
  });

  // The URL we want to show next (drives the fade-in layer)
  // Derived directly from photo state — no mutable intermediary
  const targetUrl = $derived.by(() => {
    if (!photo) return null;
    if (latestMode) return photo.displayUrl ?? null;
    return photo.displayUrl ?? photo.thumbnailUrl ?? null;
  });

  // Shimmer: show while display fetch is in progress and no display yet
  const shimmer = $derived(
    photo !== null && photo.displayProgress !== null && photo.displayUrl === null
  );

  const timeLabel = $derived(
    photo
      ? photo.capturedAt.toLocaleString([], {
          month: 'short', day: 'numeric',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
        })
      : ''
  );

  const variantLabel = $derived(
    photo?.variants.map(v => v.split('.').pop()?.toUpperCase()).join(' + ') ?? ''
  );

  // Show photo settings or fall back to live settings if photo has none
  const displaySettings = $derived(photo?.settings ?? liveSettings);

  const METERING: Record<string, string> = {
    evaluative:              '⬡ Evaluative',
    spot:                    '⊙ Spot',
    partial:                 '◎ Partial',
    center_weighted_average: '◉ Center',
  };

  const WB: Record<string, string> = {
    auto:             'AWB',
    daylight:         '☀ Daylight',
    shade:            '🌥 Shade',
    cloudy:           '☁ Cloudy',
    tungsten:         '💡 Tungsten',
    whitefluorescent: '☯ Fluorescent',
    flash:            '⚡ Flash',
    custom:           'Custom WB',
    awbwhite:         'AWB White',
  };

  function navigate(newIndex: number) {
    const newPhoto = photos[newIndex];
    if (!newPhoto) return;
    // $effect.pre captures renderedUrl = currentBestUrl before photo changes
    currentId = newPhoto.id;
    onfetchdisplay?.(newPhoto.id);
  }

  function prev() {
    if (latestMode) return;
    navigate(Math.min(index + 1, photos.length - 1));
  }

  function next() {
    if (latestMode) return;
    navigate(Math.max(index - 1, 0));
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => { isFullscreen = true; }).catch(() => {});
    } else {
      document.exitFullscreen().then(() => { isFullscreen = false; }).catch(() => {});
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape')       { onclose(); return; }
    if (e.key === 'ArrowLeft')    { prev(); return; }
    if (e.key === 'ArrowRight')   { next(); return; }
    if (e.key === 'f' || e.key === 'F') { toggleFullscreen(); return; }
    if (e.key === 'l' || e.key === 'L') { latestMode = !latestMode; return; }
    if (e.key === 'c' || e.key === 'C') { showControls = !showControls; return; }
  }

  // Listen for external fullscreen change (e.g. user presses Esc in native fullscreen)
  function handleFullscreenChange() {
    isFullscreen = !!document.fullscreenElement;
  }
</script>

<svelte:window onkeydown={handleKeydown} onfullscreenchange={handleFullscreenChange} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="lightbox" transition:fade={{ duration: 150 }} onclick={(e) => e.target === e.currentTarget && onclose()}>

  <!-- Close -->
  <button class="btn-icon btn-close" onclick={onclose} aria-label="Close lightbox">✕</button>

  <!-- Fullscreen -->
  <button class="btn-icon btn-fullscreen" onclick={toggleFullscreen} title="Fullscreen (F)" aria-label="Toggle fullscreen">
    {isFullscreen ? '⛶' : '⛶'}
    <span class="sr-only">{isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}</span>
  </button>

  <!-- Display Controls button -->
  <button
    class="btn-icon btn-controls"
    class:active={showControls}
    onclick={() => showControls = !showControls}
    title="Display controls (C)"
    aria-label="Toggle display controls"
  >⚙</button>

  <!-- Display Controls panel -->
  {#if showControls}
    <div class="controls-panel" transition:fade={{ duration: 120 }} onclick={(e) => e.stopPropagation()}>
      <div class="controls-title">Display controls</div>
      <label class="control-row">
        <span class="control-label">Curved corners</span>
        <button
          class="toggle"
          class:on={curvedCorners}
          onclick={() => curvedCorners = !curvedCorners}
          aria-pressed={curvedCorners}
          role="switch"
        ><span class="toggle-knob"></span></button>
      </label>
      <label class="control-row">
        <span class="control-label">Ambient backlight</span>
        <button
          class="toggle"
          class:on={ambientEnabled}
          onclick={() => ambientEnabled = !ambientEnabled}
          aria-pressed={ambientEnabled}
          role="switch"
        ><span class="toggle-knob"></span></button>
      </label>
      <label class="control-row" class:disabled={!ambientEnabled}>
        <span class="control-label">Image shadow</span>
        <button
          class="toggle"
          class:on={shadowEnabled && ambientEnabled}
          onclick={() => { if (ambientEnabled) shadowEnabled = !shadowEnabled; }}
          aria-pressed={shadowEnabled && ambientEnabled}
          aria-disabled={!ambientEnabled}
          role="switch"
        ><span class="toggle-knob"></span></button>
      </label>
    </div>
  {/if}

  <!-- Main image area -->
  {#if photo}
    <div class="image-area" onclick={(e) => e.stopPropagation()}>

      <!-- Ambient backlight: blurred copy of the image radiating behind it -->
      <!-- Always rendered (when image available) so opacity transition can fade it -->
      {#if shownUrl}
        <img src={shownUrl} alt="" aria-hidden="true" class="ambient-glow" class:ambient-off={!ambientEnabled} />
      {/if}

      <div class="image-wrap">
        <!-- Layer 1 (bg): last confirmed good image — crossfade source -->
        {#if shownUrl}
          <img src={shownUrl} alt={photo.filename} class="main-img" class:curved={curvedCorners} class:shadowed={shadowEnabled && ambientEnabled} />
        {:else}
          <div class="placeholder">
            <span class="placeholder-icon">📷</span>
            <span>Loading…</span>
          </div>
        {/if}

        <!-- Layer 2 (top): targetUrl swaps in instantly when better image is ready -->
        {#if targetUrl && targetUrl !== shownUrl}
          <img
            src={targetUrl}
            alt={photo.filename}
            class="main-img main-img--top"
            class:curved={curvedCorners}
            class:shadowed={shadowEnabled && ambientEnabled}
            onload={() => { shownUrl = targetUrl; }}
            onerror={() => { /* leave shownUrl — keep previous visible */ }}
          />
        {/if}

        <!-- Shimmer border: visible while display fetch is in progress -->
        {#if shimmer}
          <div class="shimmer-border" class:curved={curvedCorners}></div>
        {/if}
      </div>
    </div>

    <!-- Bottom bar -->
    <div class="bottom-bar" onclick={(e) => e.stopPropagation()}>
      <!-- Prev button -->
      <button
        class="nav-btn"
        onclick={prev}
        disabled={latestMode || index >= photos.length - 1}
        aria-label="Previous photo"
      >←</button>

      <!-- Info -->
      <div class="info">
        <span class="filename">{photo.filename}</span>
        {#if variantLabel}
          <span class="variant-badge">{variantLabel}</span>
        {/if}
        <span class="sep">·</span>
        <span class="time">{timeLabel}</span>
        {#if displaySettings?.av || displaySettings?.tv || displaySettings?.iso}
          <span class="sep">·</span>
          {#if displaySettings.av}<span class="exif">{displaySettings.av}</span>{/if}
          {#if displaySettings.tv}<span class="exif">{displaySettings.tv}</span>{/if}
          {#if displaySettings.iso}<span class="exif">ISO {displaySettings.iso}</span>{/if}
          {#if formatExposure(displaySettings.exposure)}
            <span class="exif exif--dim">{formatExposure(displaySettings.exposure)} EV</span>
          {/if}
        {/if}
        {#if displaySettings?.metering || displaySettings?.wb || displaySettings?.afoperation}
          <span class="sep">·</span>
          {#if displaySettings.afoperation}<span class="exif exif--dim">{displaySettings.afoperation === 'manual' ? 'MF' : displaySettings.afoperation.toUpperCase()}</span>{/if}
          {#if displaySettings.metering}<span class="exif exif--dim">{METERING[displaySettings.metering] ?? displaySettings.metering}</span>{/if}
          {#if displaySettings.wb}
            <span class="exif exif--dim">
              {displaySettings.wb === 'colortemp' && displaySettings.colortemp
                ? `${displaySettings.colortemp}K`
                : WB[displaySettings.wb] ?? displaySettings.wb}
            </span>
          {/if}
        {/if}
        <span class="sep">·</span>
        <span class="counter">{photos.length - index} / {photos.length}</span>
      </div>

      <!-- Latest mode toggle -->
      <button
        class="latest-btn"
        class:active={latestMode}
        onclick={() => { latestMode = !latestMode; }}
        title="Always show latest photo (L)"
        aria-label="Toggle latest mode"
        aria-pressed={latestMode}
      >
        {latestMode ? '⏺ Latest' : '⏺ Latest'}
      </button>

      <!-- Next button -->
      <button
        class="nav-btn"
        onclick={next}
        disabled={latestMode || index <= 0}
        aria-label="Next photo"
      >→</button>
    </div>
  {/if}
</div>

<style>
  .lightbox {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.92);
    z-index: 200;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }

  /* Floating buttons */
  .btn-icon {
    position: absolute;
    top: 1rem;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.1);
    color: #9ca3af;
    border-radius: 8px;
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 0.9rem;
    transition: background 0.15s, color 0.15s;
  }
  .btn-icon:hover { background: rgba(255,255,255,0.12); color: #e5e7eb; }

  .btn-close      { right: 1rem; z-index: 10; }
  .btn-fullscreen { right: 3.5rem; z-index: 10; }
  .btn-controls   { right: 6rem; z-index: 10; }
  .btn-controls.active { background: rgba(var(--accent-rgb),0.15); border-color: rgba(var(--accent-rgb),0.5); color: var(--accent-light); }

  .sr-only {
    position: absolute;
    width: 1px; height: 1px;
    overflow: hidden;
    clip: rect(0,0,0,0);
  }

  /* Image */
  .image-area {
    flex: 1;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    padding: 3.5rem 4rem 0;
    position: relative;
    isolation: isolate; /* keep ambient glow contained */
  }

  .image-wrap {
    max-width: 100%;
    max-height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    z-index: 1;
  }

  .main-img {
    max-width: 100%;
    max-height: calc(100vh - 10rem);
    object-fit: contain;
    border-radius: 4px;
    transition: border-radius 0.3s ease, box-shadow 0.3s ease;
  }

  /* Shadow — independent of corner rounding */
  .main-img.shadowed {
    box-shadow: 0 8px 40px rgba(0,0,0,0.35);
  }

  /* Curved corners — only affects border-radius, no shadow change */
  .main-img.curved {
    border-radius: 20px / 14px;
  }

  .main-img--top {
    /* Foreground layer — fades in on top of bg image */
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    max-width: 100%;
    max-height: calc(100vh - 10rem);
    object-fit: contain;
  }

  /* Ambient glow: blurred, scaled-up copy of the image radiating colour behind it */
  .ambient-glow {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    filter: blur(80px) saturate(1.4) brightness(0.55);
    opacity: 0.75;
    pointer-events: none;
    transform: scale(1.15);
    z-index: 0;
    transition: opacity 0.5s ease;
  }
  .ambient-glow.ambient-off {
    opacity: 0;
  }

  .image-wrap { position: relative; z-index: 1; }

  /* Controls panel — floats below the top-right buttons */
  .controls-panel {
    position: absolute;
    top: 3.5rem;
    right: 1rem;
    z-index: 20;
    background: rgba(15, 15, 20, 0.92);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 10px;
    padding: 0.75rem 1rem;
    min-width: 200px;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .controls-title {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #6b7280;
    padding-bottom: 0.4rem;
    border-bottom: 1px solid rgba(255,255,255,0.06);
  }

  .control-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    cursor: pointer;
  }

  .control-label {
    font-size: 0.8rem;
    color: #d1d5db;
    transition: color 0.2s;
  }

  .control-row.disabled {
    opacity: 0.35;
    cursor: not-allowed;
    pointer-events: none;
  }

  /* Toggle switch */
  .toggle {
    position: relative;
    width: 36px;
    height: 20px;
    background: rgba(255,255,255,0.1);
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 999px;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.2s, border-color 0.2s;
    padding: 0;
  }
  .toggle.on {
    background: rgba(var(--accent-rgb),0.7);
    border-color: rgba(var(--accent-rgb),0.8);
  }
  .toggle-knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.2s;
    display: block;
  }
  .toggle.on .toggle-knob {
    transform: translateX(16px);
  }

  /* Shimmer border — pulses around image-wrap while HD fetch is in progress */
  .shimmer-border {
    position: absolute;
    inset: -3px;
    border-radius: 7px; /* matches default 4px image corner + 3px inset offset */
    transition: border-radius 0.3s ease;
    pointer-events: none;
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(129, 140, 248, 0.0) 20%,
      rgba(129, 140, 248, 0.6) 50%,
      rgba(129, 140, 248, 0.0) 80%,
      transparent 100%
    );
    background-size: 200% 100%;
    animation: shimmer-sweep 1.4s ease-in-out infinite;
    mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    mask-composite: exclude;
    padding: 3px;
  }

  .shimmer-border.curved {
    border-radius: 23px / 17px; /* matches 20px/14px image corner + 3px inset offset */
  }

  @keyframes shimmer-sweep {
    0%   { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  .placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    color: #4b5563;
    font-size: 0.875rem;
  }

  .placeholder-icon { font-size: 3rem; opacity: 0.4; }

  /* Bottom bar */
  .bottom-bar {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1.5rem;
    background: rgba(0,0,0,0.4);
    backdrop-filter: blur(8px);
    border-top: 1px solid rgba(255,255,255,0.06);
  }

  .nav-btn {
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.1);
    color: #9ca3af;
    border-radius: 6px;
    width: 36px;
    height: 36px;
    font-size: 1rem;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.15s, color 0.15s;
  }
  .nav-btn:hover:not(:disabled) { background: rgba(255,255,255,0.12); color: #e5e7eb; }
  .nav-btn:disabled { opacity: 0.25; cursor: not-allowed; }

  .info {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    overflow: hidden;
    font-size: 0.8rem;
    color: #9ca3af;
  }

  .filename {
    font-family: monospace;
    color: #e5e7eb;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .variant-badge {
    background: #1e293b;
    color: var(--accent-light);
    font-size: 0.65rem;
    font-weight: 600;
    padding: 0.1rem 0.35rem;
    border-radius: 3px;
    border: 1px solid var(--accent-border);
    flex-shrink: 0;
  }

  .sep { color: #374151; flex-shrink: 0; }
  .time, .counter { white-space: nowrap; flex-shrink: 0; }

  .exif {
    white-space: nowrap;
    flex-shrink: 0;
    color: #e5e7eb;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }

  .exif--dim {
    color: #6b7280;
    font-weight: 400;
  }

  .latest-btn {
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.1);
    color: #6b7280;
    border-radius: 6px;
    padding: 0 0.75rem;
    height: 32px;
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
    flex-shrink: 0;
    transition: all 0.15s;
    white-space: nowrap;
  }
  .latest-btn.active {
    background: rgba(var(--accent-rgb), 0.15);
    border-color: rgba(var(--accent-rgb), 0.5);
    color: var(--accent-light);
  }
  .latest-btn:hover { border-color: rgba(255,255,255,0.2); color: #e5e7eb; }
  .latest-btn.active:hover { border-color: rgba(var(--accent-rgb), 0.8); color: var(--accent-pale); }
</style>
