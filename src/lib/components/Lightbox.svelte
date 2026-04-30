<script lang="ts">
  import { fly, fade } from 'svelte/transition';
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

  // Track by photo ID so array prepends don't silently change the viewed photo
  // untrack() reads initial prop values without creating reactive dependencies
  let currentId = $state(untrack(() => photos[initialIndex]?.id ?? null));

  // The best available URL for the current photo (display > thumbnail)
  // Updated reactively — drives the top fade-in layer
  const currentBestUrl = $derived.by(() => {
    if (!photo) return null;
    if (latestMode) return photo.displayUrl ?? null; // no thumbnail in latest mode
    return photo.displayUrl ?? photo.thumbnailUrl ?? null;
  });

  // Track the last rendered URL — stays as crossfade source while new image loads
  // Only updated via onintroend after a fade completes
  let renderedUrl = $state<string | null>(
    untrack(() => {
      const p = photos[initialIndex];
      return p?.displayUrl ?? (latestMode ? null : p?.thumbnailUrl) ?? null;
    })
  );

  // Track which photo id renderedUrl belongs to
  // When photo changes identity, clear renderedUrl so the old photo
  // doesn't show through as the crossfade bg for the new photo
  let renderedPhotoId = $state<string | null>(
    untrack(() => photos[initialIndex]?.id ?? null)
  );

  $effect(() => {
    const id = photo?.id ?? null;
    if (id !== renderedPhotoId) {
      renderedPhotoId = id;
      renderedUrl = null; // clear bg — new photo, no crossfade source
    }
  });

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

  function navigate(newIndex: number) {
    const newPhoto = photos[newIndex];
    if (!newPhoto) return;
    // Do NOT update renderedUrl here — it must stay as the current photo's
    // image so it acts as the crossfade source. renderedUrl is only updated
    // via onintroend after the new image has fully faded in.
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
      <!-- Image wrap: renderedUrl holds the last good image (prev or current).
           When a better image arrives, it fades in on top via {#key}. -->
      <div class="image-wrap">
        <!-- Layer 1: previous/current rendered image (always visible until replaced) -->
        {#if renderedUrl}
          <img
            src={renderedUrl}
            alt={photo.filename}
            class="main-img main-img--bg"
            onerror={() => { renderedUrl = null; }}
          />
        {:else}
          <div class="placeholder">
            <span class="placeholder-icon">📷</span>
            <span>Loading…</span>
          </div>
        {/if}

        <!-- Layer 2: currentBestUrl fades in when it differs from what's rendered -->
        {#if currentBestUrl && currentBestUrl !== renderedUrl}
          {@const capturedUrl = currentBestUrl}
          {#key capturedUrl}
            <img
              src={capturedUrl}
              alt={photo.filename}
              class="main-img main-img--top"
              in:fade={{ duration: 300 }}
              onintroend={() => { renderedUrl = capturedUrl; }}
              onerror={() => { /* leave renderedUrl unchanged — bg layer stays */ }}
            />
          {/key}
        {/if}
        <!-- Shimmer border: inside image-wrap, hugs the image edge while HD loads -->
        {#if !photo.displayUrl}
          <div class="shimmer-border"></div>
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
  }

  .image-wrap {
    max-width: 100%;
    max-height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
  }

  .main-img {
    max-width: 100%;
    max-height: calc(100vh - 10rem);
    object-fit: contain;
    border-radius: 4px;
    box-shadow: 0 8px 40px rgba(0,0,0,0.6);
  }

  .main-img--bg {
    display: block; /* background layer — always visible */
  }

  .main-img--top {
    /* Foreground layer — fades in on top of bg */
    position: absolute;
    inset: 0;
    margin: auto;
  }

  /* Shimmer border — pulses around image-wrap while HD fetch is in progress */
  .shimmer-border {
    position: absolute;
    inset: -3px;
    border-radius: 7px;
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
