/**
 * clean-build.mjs — remove files from build/ that should not be bundled
 *
 * js-runtime (and js-runtime.exe on Windows) is placed in build/ by the
 * sidecar setup script, but Tauri bundles it via externalBin into Contents/MacOS/.
 * Including it in build/ (mapped to Resources/build/) would create a duplicate.
 */

import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const filesToRemove = [
  join(root, 'build', 'js-runtime'),
  join(root, 'build', 'js-runtime.exe'),
];

for (const f of filesToRemove) {
  try {
    rmSync(f);
    console.log(`[clean-build] removed ${f}`);
  } catch {
    // File doesn't exist — that's fine
  }
}
