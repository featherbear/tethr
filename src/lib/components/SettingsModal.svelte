<script lang="ts">
  interface Props {
    onclose: () => void;
  }
  const { onclose }: Props = $props();

  let ip       = $state('');
  let port     = $state(8080);
  let useHttps = $state(false);
  let saving   = $state(false);
  let loaded   = $state(false);

  // Load current config on mount
  $effect(() => {
    fetch('/api/camera')
      .then(r => r.json())
      .then(cfg => {
        ip       = cfg.ip       ?? '192.168.1.2';
        port     = cfg.port     ?? 8080;
        useHttps = cfg.https    ?? false;
        loaded   = true;
      })
      .catch(() => { loaded = true; });
  });

  // Auto-switch port/protocol on well-known values
  function onProtocolChange() {
    if (useHttps && port === 8080) port = 443;
    else if (!useHttps && port === 443) port = 8080;
  }

  function onPortChange() {
    if (port === 443) useHttps = true;
    else if (port === 8080) useHttps = false;
  }

  async function save() {
    saving = true;
    try {
      await fetch('/api/camera', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip, port, https: useHttps }),
      });
      onclose();
    } finally {
      saving = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <div class="modal" role="dialog" aria-modal="true" aria-label="Camera Settings">
    <div class="modal__header">
      <h2>Camera Settings</h2>
      <button class="close-btn" onclick={onclose} aria-label="Close">✕</button>
    </div>

    {#if !loaded}
      <div class="loading">Loading…</div>
    {:else}
      <div class="modal__body">
        <div class="field-row">
          <div class="field field--protocol">
            <label for="s-protocol">Protocol</label>
            <select id="s-protocol" bind:value={useHttps} onchange={onProtocolChange}>
              <option value={false}>HTTP</option>
              <option value={true}>HTTPS</option>
            </select>
          </div>
          <div class="field field--ip">
            <label for="s-ip">Camera IP Address</label>
            <input id="s-ip" type="text" bind:value={ip} placeholder="192.168.1.2" />
          </div>
          <div class="field field--port">
            <label for="s-port">Port</label>
            <input id="s-port" type="number" bind:value={port} min="1" max="65535" onchange={onPortChange} />
          </div>
        </div>

        <p class="hint">
          Changes will cause the server to reconnect to the camera immediately.
        </p>
      </div>

      <div class="modal__footer">
        <button class="btn btn--ghost" onclick={onclose}>Cancel</button>
        <button class="btn btn--primary" onclick={save} disabled={saving || !ip}>
          {saving ? 'Saving…' : 'Save & Reconnect'}
        </button>
      </div>
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.6);
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
    width: 480px;
    max-width: 90vw;
    box-shadow: 0 24px 60px rgba(0,0,0,0.6);
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
  }

  .close-btn:hover { color: #e5e7eb; }

  .modal__body {
    padding: 1.25rem 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .loading {
    padding: 2rem 1.5rem;
    text-align: center;
    color: #6b7280;
    font-size: 0.875rem;
  }

  .field-row {
    display: flex;
    gap: 0.75rem;
    align-items: flex-end;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .field--protocol { width: 100px; flex-shrink: 0; }
  .field--ip       { flex: 1; }
  .field--port     { width: 90px; flex-shrink: 0; }

  label {
    font-size: 0.7rem;
    color: #6b7280;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  input, select {
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 6px;
    color: #e5e7eb;
    font-size: 0.875rem;
    padding: 0.45rem 0.65rem;
    outline: none;
    transition: border-color 0.15s;
    width: 100%;
  }

  input:focus, select:focus { border-color: #6366f1; }

  .hint {
    font-size: 0.75rem;
    color: #4b5563;
    margin: 0;
  }

  .modal__footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    padding: 1rem 1.5rem;
    border-top: 1px solid #222;
  }

  .btn {
    padding: 0.5rem 1.1rem;
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 500;
    border: none;
    cursor: pointer;
    transition: opacity 0.15s, background 0.15s;
  }

  .btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .btn--primary { background: #6366f1; color: white; }
  .btn--primary:hover:not(:disabled) { background: #4f46e5; }

  .btn--ghost {
    background: transparent;
    color: #9ca3af;
    border: 1px solid #333;
  }
  .btn--ghost:hover { background: #1f1f1f; }
</style>
