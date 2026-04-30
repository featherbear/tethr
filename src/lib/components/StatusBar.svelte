<script lang="ts">
  import type { ConnectionStatus } from '$lib/stores/camera.svelte';

  interface Props {
    status: ConnectionStatus;
    errorMessage?: string | null;
    shotCount?: number;
  }

  const { status, errorMessage = null, shotCount = 0 }: Props = $props();

  const statusConfig: Record<ConnectionStatus, { label: string; color: string }> = {
    idle:         { label: 'Idle',         color: '#6b7280' },
    connecting:   { label: 'Connecting…',  color: '#f59e0b' },
    live:         { label: 'Live',         color: '#22c55e' },
    reconnecting: { label: 'Reconnecting…',color: '#f59e0b' },
    error:        { label: 'Error',        color: '#ef4444' },
  };

  const cfg = $derived(statusConfig[status]);
</script>

<div class="status-bar">
  <div class="indicator">
    <span class="dot" style:background={cfg.color} class:pulse={status === 'live'}></span>
    <span class="label">{cfg.label}</span>
    {#if errorMessage && status === 'error'}
      <span class="error-msg">{errorMessage}</span>
    {/if}
  </div>
  {#if shotCount > 0}
    <span class="shot-count">{shotCount} {shotCount === 1 ? 'photo' : 'photos'}</span>
  {/if}
</div>

<style>
  .status-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 1.25rem;
    background: #111;
    border-bottom: 1px solid #222;
    font-size: 0.8rem;
    color: #9ca3af;
    user-select: none;
  }

  .indicator {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .dot.pulse {
    animation: pulse 2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.4; }
  }

  .label {
    font-weight: 500;
    color: #e5e7eb;
  }

  .error-msg {
    color: #ef4444;
    font-size: 0.75rem;
    max-width: 400px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .shot-count {
    color: #6b7280;
  }
</style>
