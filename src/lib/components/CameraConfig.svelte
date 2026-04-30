<script lang="ts">
  import { cameraStore } from '$lib/stores/camera.svelte';

  interface Props {
    onconnect: () => void;
    ondisconnect: () => void;
  }

  const { onconnect, ondisconnect }: Props = $props();

  let ip = $state(cameraStore.ip);
  let port = $state(cameraStore.port);
  let saving = $state(false);

  const isConnected = $derived(
    cameraStore.status === 'live' || cameraStore.status === 'connecting'
  );

  async function save() {
    saving = true;
    try {
      await fetch('/api/camera', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip, port }),
      });
      cameraStore.setIp(ip);
      cameraStore.setPort(port);
    } finally {
      saving = false;
    }
  }

  async function handleConnect() {
    await save();
    onconnect();
  }
</script>

<div class="config">
  <div class="fields">
    <div class="field">
      <label for="camera-ip">Camera IP</label>
      <input
        id="camera-ip"
        type="text"
        bind:value={ip}
        placeholder="192.168.1.2"
        disabled={isConnected}
      />
    </div>
    <div class="field field--port">
      <label for="camera-port">Port</label>
      <input
        id="camera-port"
        type="number"
        bind:value={port}
        min="1"
        max="65535"
        disabled={isConnected}
      />
    </div>
  </div>

  <div class="actions">
    {#if isConnected}
      <button class="btn btn--danger" onclick={ondisconnect}>Disconnect</button>
    {:else}
      <button
        class="btn btn--primary"
        onclick={handleConnect}
        disabled={saving || !ip}
      >
        {saving ? 'Saving…' : 'Connect'}
      </button>
    {/if}
  </div>
</div>

<style>
  .config {
    display: flex;
    align-items: flex-end;
    gap: 1rem;
    padding: 0.75rem 1.25rem;
    background: #111;
    border-bottom: 1px solid #222;
  }

  .fields {
    display: flex;
    gap: 0.75rem;
    flex: 1;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    flex: 1;
  }

  .field--port {
    max-width: 100px;
  }

  label {
    font-size: 0.7rem;
    color: #6b7280;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  input {
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 6px;
    color: #e5e7eb;
    font-size: 0.875rem;
    padding: 0.4rem 0.6rem;
    outline: none;
    transition: border-color 0.15s;
  }

  input:focus {
    border-color: #6366f1;
  }

  input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .actions {
    flex-shrink: 0;
  }

  .btn {
    padding: 0.45rem 1rem;
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 500;
    border: none;
    cursor: pointer;
    transition: opacity 0.15s;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn--primary {
    background: #6366f1;
    color: white;
  }

  .btn--primary:hover:not(:disabled) {
    background: #4f46e5;
  }

  .btn--danger {
    background: #1f1f1f;
    color: #ef4444;
    border: 1px solid #333;
  }

  .btn--danger:hover {
    background: #2a1a1a;
  }
</style>
