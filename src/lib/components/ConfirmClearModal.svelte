<script lang="ts">
  import { fade, scale } from 'svelte/transition';

  interface Props {
    photoCount: number;
    onconfirm?: () => void;
    oncancel?: () => void;
  }

  const { photoCount, onconfirm, oncancel }: Props = $props();

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.stopPropagation(); oncancel?.(); }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" transition:fade={{ duration: 150 }} onclick={(e) => e.target === e.currentTarget && oncancel?.()}>
  <div class="modal" role="dialog" aria-modal="true" aria-label="Clear photo library" transition:scale={{ duration: 150, start: 0.95 }}>
    <div class="icon-wrap" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none">
        <polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M19 6l-1 14H6L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M9 6V4h6v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>
    <h2 class="title">Clear photo library?</h2>
    <p class="body">
      This will remove all <strong>{photoCount}</strong> cached photo{photoCount === 1 ? '' : 's'} from this device.
      Photos on your camera's memory card are not affected.
    </p>
    <div class="actions">
      <button class="btn btn-cancel" onclick={oncancel}>Cancel</button>
      <button class="btn btn-clear" onclick={onconfirm}>Clear library</button>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .modal {
    background: #111116;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 14px;
    padding: 2rem;
    max-width: 360px;
    width: 90%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    text-align: center;
    box-shadow: 0 24px 64px rgba(0,0,0,0.6);
  }

  .icon-wrap {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: rgba(239,68,68,0.12);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #f87171;
    margin-bottom: 0.25rem;
  }
  .icon-wrap svg { width: 24px; height: 24px; }

  .title {
    font-size: 1rem;
    font-weight: 600;
    color: #f9fafb;
    margin: 0;
  }

  .body {
    font-size: 0.82rem;
    color: #9ca3af;
    line-height: 1.5;
    margin: 0;
  }
  .body strong { color: #d1d5db; font-weight: 600; }

  .actions {
    display: flex;
    gap: 0.75rem;
    margin-top: 0.5rem;
    width: 100%;
  }

  .btn {
    flex: 1;
    padding: 0.55rem 1rem;
    border-radius: 8px;
    border: 1px solid transparent;
    font-size: 0.82rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
  }

  .btn-cancel {
    background: rgba(255,255,255,0.06);
    border-color: rgba(255,255,255,0.1);
    color: #d1d5db;
  }
  .btn-cancel:hover { background: rgba(255,255,255,0.1); color: #f9fafb; }

  .btn-clear {
    background: rgba(239,68,68,0.15);
    border-color: rgba(239,68,68,0.3);
    color: #f87171;
  }
  .btn-clear:hover { background: rgba(239,68,68,0.25); border-color: rgba(239,68,68,0.5); color: #fca5a5; }
</style>
