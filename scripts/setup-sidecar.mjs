#!/usr/bin/env node
// setup-sidecar.mjs — Copy the local Node.js binary into src-tauri/binaries/
// with the Tauri-required triple suffix for the current platform.
//
// Cross-platform: works on macOS, Linux, and Windows.
// Run via: pnpm sidecar  (or node scripts/setup-sidecar.mjs)

import { execSync } from 'child_process';
import { copyFileSync, mkdirSync, chmodSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { platform } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// Get Node.js binary path
const nodeBin = process.execPath;

// Get Rust host triple — try to find rustc, sourcing ~/.cargo/env on Unix if needed
let triple;
try {
  const isWin = platform() === 'win32';
  // On Unix, rustup installs to ~/.cargo/bin which may not be in PATH in non-login shells
  const rustcCmd = isWin
    ? 'rustc -vV'
    : `bash -c "source \\"$HOME/.cargo/env\\" 2>/dev/null; rustc -vV"`;
  const output = execSync(rustcCmd, { encoding: 'utf8', shell: true });
  const match = output.match(/^host:\s+(.+)$/m);
  if (!match) throw new Error('Could not parse host triple from rustc output');
  triple = match[1].trim();
} catch (e) {
  console.error('❌  Rust/Cargo not found. Install via: https://rustup.rs');
  process.exit(1);
}

const isWindows = platform() === 'win32';
const suffix = isWindows ? '.exe' : '';
const destName = `node-server-${triple}${suffix}`;
const destDir  = join(root, 'src-tauri', 'binaries');
const dest     = join(destDir, destName);

mkdirSync(destDir, { recursive: true });

console.log('📦  Copying Node binary...');
console.log(`    From: ${nodeBin}`);
console.log(`    To:   ${dest}`);

copyFileSync(nodeBin, dest);

// Make executable on Unix
if (!isWindows) {
  chmodSync(dest, 0o755);
}

const sizeMB = (statSync(dest).size / 1024 / 1024).toFixed(0);
console.log(`✅  Sidecar ready: ${destName} (${sizeMB}MB)`);
