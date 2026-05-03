/**
 * clean-build.mjs — post-build cleanup
 *
 * Currently a no-op placeholder. Previously removed js-runtime from build/
 * but that's now handled by the download-sidecar script writing to
 * src-tauri/binaries/ directly (not into build/).
 *
 * Kept as a hook for future cleanup tasks.
 */

console.log('[clean-build] nothing to clean');
