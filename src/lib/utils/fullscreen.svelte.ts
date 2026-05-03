/**
 * fullscreen.svelte.ts — shared fullscreen toggle logic
 *
 * Usage in a Svelte 5 component:
 *   import { useFullscreen } from '$lib/utils/fullscreen.svelte';
 *   const fs = useFullscreen();
 *   // fs.isFullscreen  — reactive boolean
 *   // fs.toggle()      — request/exit fullscreen
 *
 * Also attach the window listener in your component template:
 *   <svelte:window onfullscreenchange={fs.handleChange} />
 */

export function useFullscreen() {
  let isFullscreen = $state(false);

  function toggle() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => { isFullscreen = true; }).catch(() => {});
    } else {
      document.exitFullscreen().then(() => { isFullscreen = false; }).catch(() => {});
    }
  }

  function handleChange() {
    isFullscreen = !!document.fullscreenElement;
  }

  return {
    get isFullscreen() { return isFullscreen; },
    toggle,
    handleChange,
  };
}
