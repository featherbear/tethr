<script lang="ts">
  import { fly, fade } from 'svelte/transition';
  import { untrack } from 'svelte';
  import type { Photo, ShootingSettings } from '$lib/stores/photos.svelte';

  interface Props {
    photos: Photo[];
    initialIndex: number;
    liveSettings?: ShootingSettings | null;
    onclose: () => void;
  }

  const { photos, initialIndex, liveSettings = null, onclose }: Props = $props();

  let latestMode = $state(false);
  let isFullscreen = $state(false);

  // Track by photo ID so array prepends don't silently change the viewed photo
  // untrack() reads initial prop values without creating reactive dependencies
  let currentId = $state(untrack(() => photos[initialIndex]?.id ?? null));

  // Derive the current index from the tracked ID (or 0 in latest mode)
  const index = $derived.by(() => {
    if (latestMode) return 0;
    if (currentId === null) return 0;
    const i = photos.findIndex(p => p.id === currentId);
    return i === -1 ? 0 : i;
  });

  const photo = $derived(photos[index] ?? null);

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

  function prev() {
    if (latestMode) return;
    const newIndex = Math.min(index + 1, photos.length - 1);
    currentId = photos[newIndex]?.id ?? currentId;
  }

  function next() {
    if (latestMode) return;
    const newIndex = Math.max(index - 1, 0);
    currentId = photos[newIndex]?.id ?? currentId;
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

  <!-- Main image area -->
  {#if photo}
    <div class="image-area" onclick={(e) => e.stopPropagation()}>
      {#key photo.id}
        <div in:fly={{ y: 20, duration: 200 }} class="image-wrap">
          {#if photo.thumbnailUrl}
            <img
              src={photo.thumbnailUrl}
              alt={photo.filename}
              class="main-img"
            />
          {:else}
            <div class="placeholder">
              <span class="placeholder-icon">📷</span>
              <span>Loading…</span>
            </div>
          {/if}
        </div>
      {/key}
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
          {#if displaySettings.exposure && displaySettings.exposure !== '+0.0'}
            <span class="exif exif--dim">{displaySettings.exposure.replace('_', ' ')} EV</span>
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

  .btn-close      { right: 1rem; }
  .btn-fullscreen { right: 3.5rem; }

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
  }

  .image-wrap {
    max-width: 100%;
    max-height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .main-img {
    max-width: 100%;
    max-height: calc(100vh - 10rem);
    object-fit: contain;
    border-radius: 4px;
    box-shadow: 0 8px 40px rgba(0,0,0,0.6);
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
    color: #818cf8;
    font-size: 0.65rem;
    font-weight: 600;
    padding: 0.1rem 0.35rem;
    border-radius: 3px;
    border: 1px solid #334155;
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
    background: rgba(99, 102, 241, 0.15);
    border-color: rgba(99, 102, 241, 0.5);
    color: #818cf8;
  }
  .latest-btn:hover { border-color: rgba(255,255,255,0.2); color: #e5e7eb; }
  .latest-btn.active:hover { border-color: rgba(99, 102, 241, 0.8); color: #a5b4fc; }
</style>
