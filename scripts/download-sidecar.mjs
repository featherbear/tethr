#!/usr/bin/env node
// download-sidecar.mjs — Download the correct Bun binary for the target
// platform/arch and place it in src-tauri/binaries/ with the Tauri triple suffix.
//
// Usage: node scripts/download-sidecar.mjs <platform> <arch>
//   platform: darwin | linux | win
//   arch:     x64 | arm64 | universal (darwin only)
//
// Uses only Node built-ins — no npm deps.

import { createWriteStream, mkdirSync, chmodSync, renameSync, rmSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { get } from 'https';
import { execSync } from 'child_process';
import { createGunzip } from 'zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const destDir = join(root, 'src-tauri', 'binaries');

const [,, nodePlatform, nodeArch] = process.argv;

if (!nodePlatform || !nodeArch) {
  console.error('Usage: node download-sidecar.mjs <platform> <arch>');
  console.error('  platform: darwin | linux | win');
  console.error('  arch:     x64 | arm64 | universal (darwin only)');
  process.exit(1);
}

// Map platform+arch → Rust triple (used for Tauri sidecar binary name)
const tripleMap = {
  'darwin-arm64':     'aarch64-apple-darwin',
  'darwin-x64':       'x86_64-apple-darwin',
  'darwin-universal': 'universal-apple-darwin',
  'linux-x64':        'x86_64-unknown-linux-gnu',
  'linux-arm64':      'aarch64-unknown-linux-gnu',
  'win-x64':          'x86_64-pc-windows-msvc',
  'win-arm64':        'aarch64-pc-windows-msvc',
};

// Map platform+arch → Bun release asset name
const bunAssetMap = {
  'darwin-arm64': 'bun-darwin-aarch64',
  'darwin-x64':   'bun-darwin-x64',
  'linux-x64':    'bun-linux-x64',
  'linux-arm64':  'bun-linux-aarch64',
  'win-x64':      'bun-windows-x64',
  'win-arm64':    'bun-windows-x64', // Bun doesn't yet ship a native win-arm64 binary
};

const key = `${nodePlatform}-${nodeArch}`;
const triple = tripleMap[key];
if (!triple) {
  console.error(`❌  Unknown platform/arch combination: ${key}`);
  process.exit(1);
}

const isWin = nodePlatform === 'win';
const suffix = isWin ? '.exe' : '';

mkdirSync(destDir, { recursive: true });

// Follow redirects and return the response stream
function download(url) {
  return new Promise((resolve, reject) => {
    const follow = (u) => get(u, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        follow(res.headers.location);
      } else if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${u}`));
      } else {
        resolve(res);
      }
    }).on('error', reject);
    follow(url);
  });
}

function saveToFile(stream, filePath) {
  return new Promise((resolve, reject) => {
    const out = createWriteStream(filePath);
    stream.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
  });
}

async function downloadBun(platform, arch) {
  const assetKey = `${platform}-${arch}`;
  const assetName = bunAssetMap[assetKey];
  if (!assetName) throw new Error(`No Bun asset for ${assetKey}`);

  const url = `https://github.com/oven-sh/bun/releases/latest/download/${assetName}.zip`;
  console.log(`    ${assetKey}: ${url}`);

  const isWindows = platform === 'win';
  const zipPath = join(destDir, `_bun-${assetKey}.zip`);
  const tmpDir  = join(destDir, `_bun-${assetKey}-tmp`);

  const res = await download(url);
  await saveToFile(res, zipPath);

  mkdirSync(tmpDir, { recursive: true });

  if (isWindows) {
    execSync(
      `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${tmpDir}' -Force"`,
      { stdio: 'inherit' }
    );
  } else {
    execSync(`unzip -q "${zipPath}" -d "${tmpDir}"`, { stdio: 'inherit' });
  }

  // Bun zip contains bun-<platform>-<arch>/bun (or bun.exe on Windows)
  const ext = isWindows ? '.exe' : '';
  const subDir = readdirSync(tmpDir).find(d => d.startsWith('bun-')) || 'bun';
  const bunBin = join(tmpDir, subDir, `bun${ext}`);

  rmSync(zipPath, { force: true });
  return { binPath: bunBin, tmpDir };
}

// ── Universal macOS: download arm64 + x64, lipo together ──────────────────
if (nodePlatform === 'darwin' && nodeArch === 'universal') {
  const destPath = join(destDir, `bun-server-universal-apple-darwin`);
  console.log('📦  Downloading Bun binaries for universal macOS build...');

  const arm64 = await downloadBun('darwin', 'arm64');
  const x64   = await downloadBun('darwin', 'x64');

  execSync(`lipo -create "${arm64.binPath}" "${x64.binPath}" -output "${destPath}"`, { stdio: 'inherit' });
  chmodSync(destPath, 0o755);

  rmSync(arm64.tmpDir, { recursive: true, force: true });
  rmSync(x64.tmpDir,   { recursive: true, force: true });

  const sizeMB = (statSync(destPath).size / 1024 / 1024).toFixed(0);
  console.log(`✅  Sidecar ready: bun-server-universal-apple-darwin (${sizeMB}MB)`);
  process.exit(0);
}

// ── Single platform ────────────────────────────────────────────────────────
const destName = `bun-server-${triple}${suffix}`;
const destPath = join(destDir, destName);

console.log(`📦  Downloading Bun for ${key} → ${triple}`);

const { binPath, tmpDir } = await downloadBun(nodePlatform, nodeArch);
renameSync(binPath, destPath);
rmSync(tmpDir, { recursive: true, force: true });

if (!isWin) chmodSync(destPath, 0o755);

const sizeMB = (statSync(destPath).size / 1024 / 1024).toFixed(0);
console.log(`✅  Sidecar ready: ${destName} (${sizeMB}MB)`);

// Write artifact path to GITHUB_ENV if in CI
const envFile = process.env.GITHUB_ENV;
if (envFile) {
  const { appendFileSync } = await import('fs');
  appendFileSync(envFile, '');
}
