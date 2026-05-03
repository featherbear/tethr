/**
 * prepare-sidecar.mjs — copy the platform-specific js-runtime binary
 * to the generic name (js-runtime / js-runtime.exe) before Tauri bundles.
 *
 * Run automatically via tauri.conf.json beforeBundleCommand.
 *
 * The download-sidecar.mjs step places e.g. js-runtime-aarch64-apple-darwin
 * in src-tauri/binaries/. Tauri's resources map expects the generic name.
 */

import { copyFileSync, chmodSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const binDir = join(root, 'src-tauri', 'binaries');

const isWin = process.platform === 'win32';
const suffix = isWin ? '.exe' : '';
const genericName = `js-runtime${suffix}`;
const genericPath = join(binDir, genericName);

// Find the platform-specific binary (any file matching js-runtime-*)
const files = readdirSync(binDir).filter(f =>
  f.startsWith('js-runtime-') && (isWin ? f.endsWith('.exe') : !f.endsWith('.exe'))
);

if (files.length === 0) {
  console.error(`❌ No js-runtime binary found in ${binDir}`);
  process.exit(1);
}

// Pick the first match (there should only be one per platform)
const src = join(binDir, files[0]);
console.log(`[prepare-sidecar] ${files[0]} → ${genericName}`);
copyFileSync(src, genericPath);
if (!isWin) chmodSync(genericPath, 0o755);
console.log(`✅ ${genericPath}`);
