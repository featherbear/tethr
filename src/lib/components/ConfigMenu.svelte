<script lang="ts">
  import { fade } from 'svelte/transition';

  interface Props {
    onconnection?: () => void;
    onclear?: () => void;
  }

  const { onconnection, onclear }: Props = $props();

  let open = $state(false);

  function close() { open = false; }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) { e.stopPropagation(); close(); }
  }

  function handleConnection() { close(); onconnection?.(); }
  function handleClear()      { close(); onclear?.(); }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="config-menu-wrap">
  <button
    class="icon-btn"
    class:active={open}
    onclick={() => open = !open}
    title="Settings"
    aria-label="Open settings menu"
    aria-expanded={open}
  >
    <!-- Hamburger menu icon — 16px grid, stroke-width 1.5, matches StatusBar icons -->
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <line x1="2" y1="4.5" x2="14" y2="4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="2" y1="8"   x2="14" y2="8"   stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="2" y1="11.5" x2="14" y2="11.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </svg>
  </button>

  {#if open}
    <!-- Invisible backdrop to close on outside click -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="backdrop" onclick={close}></div>

    <div class="menu" transition:fade={{ duration: 100 }} role="menu">
      <button class="menu-item" role="menuitem" onclick={handleConnection}>
        <svg class="menu-icon" viewBox="0 0 24 24" fill="none">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Camera connection
      </button>
      <div class="divider"></div>
      <button class="menu-item menu-item--danger" role="menuitem" onclick={handleClear}>
        <svg class="menu-icon" viewBox="0 0 24 24" fill="none">
          <polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M19 6l-1 14H6L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M9 6V4h6v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Clear photo library
      </button>
    </div>
  {/if}
</div>

<style>
  .config-menu-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }

  /* Inherit icon-btn from StatusBar's global-ish style via parent */
  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: transparent;
    color: #9ca3af;
    cursor: pointer;
    padding: 0.25rem;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }
  .icon-btn svg { width: 1rem; height: 1rem; }
  .icon-btn:hover { background: rgba(255,255,255,0.06); color: #e5e7eb; }
  .icon-btn.active {
    background: rgba(var(--accent-rgb), 0.12);
    border-color: rgba(var(--accent-rgb), 0.4);
    color: var(--accent-light);
  }

  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 99;
  }

  .menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 100;
    background: rgba(15, 15, 20, 0.96);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 10px;
    padding: 0.35rem;
    min-width: 190px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .menu-item {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.5rem 0.65rem;
    border-radius: 7px;
    border: none;
    background: transparent;
    color: #d1d5db;
    font-size: 0.8rem;
    cursor: pointer;
    text-align: left;
    transition: background 0.12s, color 0.12s;
    width: 100%;
  }
  .menu-item:hover { background: rgba(255,255,255,0.07); color: #f9fafb; }
  .menu-item--danger { color: #f87171; }
  .menu-item--danger:hover { background: rgba(239,68,68,0.1); color: #fca5a5; }

  .menu-icon { width: 14px; height: 14px; flex-shrink: 0; }

  .divider {
    height: 1px;
    background: rgba(255,255,255,0.07);
    margin: 0.2rem 0;
  }
</style>
