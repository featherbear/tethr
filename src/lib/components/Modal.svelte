<!--
  Modal.svelte — reusable modal overlay wrapper

  Usage:
    <Modal title="My Modal" onclose={onclose}>
      {#snippet body()}...{/snippet}
      {#snippet footer()}...{/snippet}
    </Modal>

  Props:
    title   — heading shown in the modal header
    onclose — called when Escape is pressed or backdrop is clicked
    width   — optional CSS width (default: 480px)
-->

<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title:   string;
    onclose: () => void;
    width?:  string;
    body?:   Snippet;
    footer?: Snippet;
  }

  const { title, onclose, width = '480px', body, footer }: Props = $props();

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="overlay"
  onclick={(e) => e.target === e.currentTarget && onclose()}
  role="presentation"
>
  <div
    class="modal"
    role="dialog"
    aria-modal="true"
    aria-label={title}
    style:max-width={width}
    tabindex="-1"
    onclick={(e) => e.stopPropagation()}
  >
    <div class="modal__header">
      <h2>{title}</h2>
      <button class="close-btn" onclick={onclose} aria-label="Close">✕</button>
    </div>

    {#if body}
      <div class="modal__body">
        {@render body()}
      </div>
    {/if}

    {#if footer}
      <div class="modal__footer">
        {@render footer()}
      </div>
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    backdrop-filter: blur(4px);
  }

  .modal {
    background: #161616;
    border: 1px solid #2a2a2a;
    border-radius: 12px;
    width: 90vw;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
  }

  .modal__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.25rem 1.5rem 1rem;
    border-bottom: 1px solid #222;
  }

  h2 {
    font-size: 1rem;
    font-weight: 600;
    color: #e5e7eb;
    margin: 0;
  }

  .close-btn {
    background: none;
    border: none;
    color: #6b7280;
    font-size: 1rem;
    cursor: pointer;
    padding: 0.25rem;
    line-height: 1;
    transition: color 0.15s;
  }

  .close-btn:hover { color: #e5e7eb; }

  .modal__body {
    padding: 1.25rem 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .modal__footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    padding: 1rem 1.5rem;
    border-top: 1px solid #222;
  }
</style>
