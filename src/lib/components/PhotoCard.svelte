<script lang="ts">
  import type { Photo } from '$lib/stores/photos.svelte';

  interface Props {
    photo: Photo;
    onclick?: () => void;
  }

  const { photo, onclick }: Props = $props();

  // Format timestamp
  const timeLabel = $derived(
    photo.capturedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  );

  // Always show file extension(s) — single file shows e.g. "JPG", multiple show "JPG+CR3"
  const variantLabel = $derived(
    photo.variants.map(v => v.split('.').pop()?.toUpperCase()).join('+')
  );
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="card"
  class:card--loading={photo.state === 'loading'}
  class:card--thumbnail={photo.state === 'thumbnail'}
  class:card--fullres={photo.state === 'fullres'}
  onclick={onclick}
>
  <div class="image-wrapper">
    {#if photo.state === 'loading'}
      <div class="shimmer"></div>
    {:else}
      <!-- Show fullres on top if available, thumbnail underneath -->
      {#if photo.thumbnailUrl}
        <img
          class="img img--thumb"
          class:img--hidden={photo.state === 'fullres'}
          src={photo.thumbnailUrl}
          alt={photo.filename}
        />
      {/if}
      {#if photo.fullresUrl}
        <img
          class="img img--fullres"
          src={photo.fullresUrl}
          alt={photo.filename}
        />
      {/if}
    {/if}

    <div class="badge">
      {#if photo.state === 'loading'}
        <span class="badge__dot badge__dot--loading"></span> Loading…
      {:else if photo.state === 'thumbnail'}
        <span class="badge__dot badge__dot--thumb"></span> Preview
      {:else}
        <span class="badge__dot badge__dot--full"></span> Full res
      {/if}
    </div>
  </div>

  <div class="meta">
    <span class="filename">{photo.filename}</span>
    <div class="meta-right">
      {#if variantLabel}
        <span class="variant-badge">{variantLabel}</span>
      {/if}
      <span class="time">{timeLabel}</span>
    </div>
  </div>
</div>

<style>
  .card {
    background: #1a1a1a;
    border-radius: 10px;
    overflow: hidden;
    border: 1px solid #2a2a2a;
    cursor: pointer;
    transition: transform 0.15s, border-color 0.15s;
  }

  .card:hover {
    transform: scale(1.02);
    border-color: #444;
  }

  .image-wrapper {
    position: relative;
    aspect-ratio: 3/2;
    background: #111;
    overflow: hidden;
  }

  /* Shimmer skeleton */
  .shimmer {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      #1a1a1a 25%,
      #2a2a2a 50%,
      #1a1a1a 75%
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
  }

  @keyframes shimmer {
    0%   { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  .img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: opacity 0.4s ease;
  }

  .img--hidden {
    opacity: 0;
  }

  .badge {
    position: absolute;
    bottom: 0.5rem;
    right: 0.5rem;
    display: flex;
    align-items: center;
    gap: 0.3rem;
    background: rgba(0,0,0,0.65);
    backdrop-filter: blur(4px);
    border-radius: 20px;
    padding: 0.2rem 0.55rem;
    font-size: 0.65rem;
    color: #ccc;
  }

  .badge__dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }

  .badge__dot--loading { background: #6b7280; animation: pulse 1.5s infinite; }
  .badge__dot--thumb   { background: #f59e0b; }
  .badge__dot--full    { background: #22c55e; }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.3; }
  }

  .meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem 0.75rem;
    font-size: 0.7rem;
    color: #6b7280;
    gap: 0.25rem;
  }

  .filename {
    font-family: monospace;
    color: #9ca3af;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .meta-right {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-shrink: 0;
  }

  .variant-badge {
    background: #1e293b;
    color: #818cf8;
    font-size: 0.6rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    padding: 0.1rem 0.35rem;
    border-radius: 3px;
    border: 1px solid #334155;
  }

  .time {
    flex-shrink: 0;
  }
</style>
