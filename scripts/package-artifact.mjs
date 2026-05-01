#!/usr/bin/env node
// package-artifact.mjs — Find the Tauri build output, rename it with consistent
// naming, and print the path to stdout for use in CI.
//
// Usage: node scripts/package-artifact.mjs <label> <tag> [rust-target]
//   label:       e.g. macos-arm64, linux-x86_64, windows-x86_64
//   tag:         e.g. v0.1.0
//   rust-target: e.g. aarch64-apple-darwin (optional, for cross-compiled macOS)

import { execSync } from 'child_process';
import { readdirSync, renameSync, statSync } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import { platform } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const [,, label, tag, rustTarget] = process.argv;
if (!label || !tag) {
  console.error('Usage: node package-artifact.mjs <label> <tag> [rust-target]');
  process.exit(1);
}

const os = platform();
// For universal-apple-darwin, Tauri outputs to universal-apple-darwin/release/bundle
// For native targets (linux, windows), output is at release/bundle
const bundleBase = join(root, 'src-tauri', 'target',
  rustTarget ? join(rustTarget, 'release', 'bundle') : join('release', 'bundle')
);

let src, ext, dest;

if (os === 'darwin') {
  // macOS: zip the .app bundle with ditto (preserves permissions + symlinks)
  const appPath = join(bundleBase, 'macos', 'tethr.app');
  dest = join(root, `tethr-${tag}-${label}.zip`);
  execSync(`ditto -c -k --keepParent "${appPath}" "${dest}"`, { stdio: 'inherit' });
} else if (os === 'linux') {
  // Linux: find and rename the .AppImage
  const appimageDir = join(bundleBase, 'appimage');
  src = readdirSync(appimageDir).find(f => f.endsWith('.AppImage'));
  if (!src) throw new Error('No .AppImage found in ' + appimageDir);
  dest = join(root, `tethr-${tag}-${label}.AppImage`);
  renameSync(join(appimageDir, src), dest);
} else if (os === 'win32') {
  // Windows: find the NSIS installer produced by Tauri and rename it
  const nsisDir = join(bundleBase.replace('release\\bundle', 'release\\bundle'), '..', 'nsis');
  const nsisAlt = join(root, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
  const searchDir = nsisAlt;
  const setupExe = readdirSync(searchDir).find(f => f.endsWith('.exe'));
  if (!setupExe) throw new Error('No NSIS .exe found in ' + searchDir);
  dest = join(root, `tethr-${tag}-${label}.exe`);
  renameSync(join(searchDir, setupExe), dest);
} else {
  console.error(`❌  Unsupported OS: ${os}`);
  process.exit(1);
}

const sizeMB = (statSync(dest).size / 1024 / 1024).toFixed(0);
console.log(`✅  Artifact: ${dest} (${sizeMB}MB)`);

// Write to GITHUB_ENV so the upload step can reference it
import { appendFileSync } from 'fs';
const envFile = process.env.GITHUB_ENV;
if (envFile) appendFileSync(envFile, `ARTIFACT=${dest}\n`);
