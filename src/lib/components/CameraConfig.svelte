<!--
  CameraConfig.svelte — camera connection form

  Two modes:
    Standalone (default): renders its own Connect/Disconnect buttons inline.
    Modal mode (modalMode=true): buttons are hidden; parent controls saving via
      triggerSave() callback and canSave binding.

  Props:
    onconnect     — called after successful connect (standalone mode)
    ondisconnect  — called when Disconnect is clicked (standalone mode)
    modalMode     — when true, suppress inline buttons; expose triggerSave + canSave
    triggerSave   — bindable: parent calls this to trigger a save; returns true on success
    canSave       — bindable: reflects whether the form is in a saveable state
-->

<script lang="ts">
  import { cameraStore } from '$lib/stores/camera.svelte';

  interface Props {
    onconnect?:    () => void;
    ondisconnect?: () => void;
    modalMode?:    boolean;
    triggerSave?:  (() => Promise<boolean>) | null;
    canSave?:      boolean;
  }

  let {
    onconnect    = undefined,
    ondisconnect = undefined,
    modalMode    = false,
    triggerSave  = $bindable(null),
    canSave      = $bindable(false),
  }: Props = $props();

  let ip       = $state('');
  let port     = $state(8080);
  let useHttps = $state(false);
  let loaded   = $state(false);
  let saving   = $state(false);
  let error    = $state<string | null>(null);

  // Load current config
  $effect(() => {
    fetch('/api/camera')
      .then(r => r.json())
      .then(cfg => {
        ip       = cfg.ip    ?? '192.168.1.2';
        port     = cfg.port  ?? 8080;
        useHttps = cfg.https ?? false;
        loaded   = true;
      })
      .catch(() => { loaded = true; });
  });

  // Auto-switch protocol when port is changed to a well-known value
  function onPortChange() {
    if (port === 443)  useHttps = true;
    else if (port === 8080) useHttps = false;
  }

  // Auto-switch port when protocol is changed (only if on the other's default)
  function onProtocolChange() {
    if (useHttps && port === 8080) port = 443;
    else if (!useHttps && port === 443) port = 8080;
  }

  const isConnected = $derived(
    cameraStore.status === 'live' || cameraStore.status === 'connecting'
  );

  // Keep canSave in sync so modal footer button can reflect state
  $effect(() => { canSave = loaded && !!ip && !saving; });

  // Expose triggerSave to parent (modal mode)
  $effect(() => {
    triggerSave = save;
  });

  async function save(): Promise<boolean> {
    saving = true;
    error  = null;
    try {
      const res = await fetch('/api/camera', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ip, port, https: useHttps }),
      });

      if (res.status === 422) {
        const body = await res.json() as { error?: string };
        error = body.error ?? 'No Canon camera found at that address.';
        return false;
      }
      if (!res.ok) {
        error = 'Failed to save settings. Please try again.';
        return false;
      }

      // Update store with confirmed values
      cameraStore.setIp(ip);
      cameraStore.setPort(port);
      cameraStore.setHttps(useHttps);
      return true;
    } catch {
      error = 'Could not connect to the server. Please try again.';
      return false;
    } finally {
      saving = false;
    }
  }

  async function handleConnect() {
    const ok = await save();
    if (ok) onconnect?.();
  }
</script>

<div class="config" class:config--modal={modalMode}>
  {#if !loaded}
    <div class="loading">Loading…</div>
  {:else}
    <div class="field-row">
      <div class="field field--protocol">
        <label for="cc-protocol">Protocol</label>
        <select
          id="cc-protocol"
          bind:value={useHttps}
          onchange={onProtocolChange}
          disabled={isConnected && !modalMode}
        >
          <option value={false}>HTTP</option>
          <option value={true}>HTTPS</option>
        </select>
      </div>
      <div class="field field--ip">
        <label for="cc-ip">Camera IP</label>
        <input
          id="cc-ip"
          type="text"
          bind:value={ip}
          placeholder="192.168.1.2"
          disabled={isConnected && !modalMode}
        />
      </div>
      <div class="field field--port">
        <label for="cc-port">Port</label>
        <input
          id="cc-port"
          type="number"
          bind:value={port}
          min="1"
          max="65535"
          onchange={onPortChange}
          disabled={isConnected && !modalMode}
        />
      </div>
    </div>

    {#if error}
      <p class="error">{error}</p>
    {/if}

    {#if modalMode}
      <p class="hint">Changes will cause the server to reconnect to the camera immediately.</p>
    {:else}
      <!-- Standalone mode: render Connect/Disconnect inline -->
      <div class="actions">
        {#if isConnected}
          <button class="btn btn--danger" onclick={ondisconnect}>Disconnect</button>
        {:else}
          <button
            class="btn btn--primary"
            onclick={handleConnect}
            disabled={saving || !ip}
          >{saving ? 'Saving…' : 'Connect'}</button>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  @import '$lib/styles/forms.css';

  .config {
    display: flex;
    align-items: flex-end;
    gap: 1rem;
    padding: 0.75rem 1.25rem;
    background: #111;
    border-bottom: 1px solid #222;
  }

  /* In modal mode, the config is just a form — no bar chrome */
  .config--modal {
    flex-direction: column;
    align-items: stretch;
    padding: 0;
    background: none;
    border: none;
  }

  .loading {
    color: #6b7280;
    font-size: 0.875rem;
    padding: 0.5rem 0;
  }

  .field-row {
    display: flex;
    gap: 0.75rem;
    align-items: flex-end;
    flex: 1;
  }

  .field--protocol { width: 100px; flex-shrink: 0; }
  .field--ip       { flex: 1; }
  .field--port     { width: 90px; flex-shrink: 0; }

  .actions { flex-shrink: 0; }

  .btn {
    padding: 0.45rem 1rem;
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 500;
    border: none;
    cursor: pointer;
    transition: opacity 0.15s, background 0.15s;
  }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn--primary { background: var(--accent); color: #fff; }
  .btn--primary:hover:not(:disabled) { background: var(--accent-dark); }
  .btn--danger { background: #1f1f1f; color: #ef4444; border: 1px solid #333; }
  .btn--danger:hover:not(:disabled) { background: #2a1a1a; }

  .hint {
    font-size: 0.75rem;
    color: #4b5563;
    margin: 0;
  }

  .error {
    font-size: 0.8rem;
    color: #ef4444;
    background: rgba(239, 68, 68, 0.08);
    border: 1px solid rgba(239, 68, 68, 0.2);
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
    margin: 0;
  }
</style>
