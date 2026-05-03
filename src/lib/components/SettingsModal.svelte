<!--
  SettingsModal.svelte — camera connection settings dialog

  Uses the shared <Modal> wrapper and <CameraConfig> form.
  All form logic lives in CameraConfig; this component only adds
  the modal chrome and the Save & Reconnect / Cancel footer buttons.
-->

<script lang="ts">
  import Modal from './Modal.svelte';
  import CameraConfig from './CameraConfig.svelte';

  interface Props {
    onclose: () => void;
  }
  const { onclose }: Props = $props();

  // Expose a save trigger to CameraConfig via a bindable callback ref
  let triggerSave = $state<(() => Promise<boolean>) | null>(null);
  let canSave = $state(false);
  let saving  = $state(false);

  async function handleSave() {
    if (!triggerSave) return;
    saving = true;
    const ok = await triggerSave();
    saving = false;
    if (ok) onclose();
  }
</script>

<Modal title="Camera Settings" {onclose}>
  {#snippet body()}
    <CameraConfig
      modalMode
      bind:triggerSave
      bind:canSave
    />
  {/snippet}

  {#snippet footer()}
    <button class="btn btn--ghost" onclick={onclose}>Cancel</button>
    <button class="btn btn--primary" onclick={handleSave} disabled={saving || !canSave}>
      {saving ? 'Saving…' : 'Save & Reconnect'}
    </button>
  {/snippet}
</Modal>

<style>
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
  .btn--primary { background: var(--accent); color: #fff; }
  .btn--primary:hover:not(:disabled) { background: var(--accent-dark); }
  .btn--ghost { background: transparent; color: #9ca3af; border: 1px solid #333; }
  .btn--ghost:hover:not(:disabled) { background: #1f1f1f; }
</style>
