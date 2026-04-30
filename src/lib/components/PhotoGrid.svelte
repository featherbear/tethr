<script lang="ts">
  import { fly } from 'svelte/transition';
  import type { Photo } from '$lib/stores/photos.svelte';
  import PhotoCard from './PhotoCard.svelte';

  interface Props {
    photos: Photo[];
    onopen: (index: number) => void;
  }

  const { photos, onopen }: Props = $props();
</script>

{#if photos.length === 0}
  <div class="empty">
    <div class="empty__icon">📷</div>
    <p class="empty__title">Waiting for shots…</p>
    <p class="empty__sub">Photos will appear here as you shoot.</p>
  </div>
{:else}
  <div class="grid">
    {#each photos as photo, i (photo.id)}
      <div in:fly={{ y: -24, duration: 300 }}>
        <PhotoCard {photo} onclick={() => onopen(i)} />
      </div>
    {/each}
  </div>
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 1rem;
    padding: 1.25rem;
    align-content: start;
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 0.5rem;
    color: #4b5563;
    user-select: none;
  }

  .empty__icon {
    font-size: 3rem;
    margin-bottom: 0.5rem;
    opacity: 0.4;
  }

  .empty__title {
    font-size: 1rem;
    font-weight: 500;
    color: #6b7280;
  }

  .empty__sub {
    font-size: 0.8rem;
    color: #4b5563;
  }
</style>
