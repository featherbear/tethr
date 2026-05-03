#!/usr/bin/env node
// download-sidecar.mjs — Download a JS runtime (Bun by default, Node optional)
// for the target platform/arch and place it in src-tauri/binaries/ with the
// Tauri triple suffix.
//
// Usage: node scripts/download-sidecar.mjs <platform> <arch> [runtime]
//   platform: darwin | linux | win
//   arch:     x64 | arm64 | universal (darwin only)
//   runtime:  bun (default) | node
//
// Note: the binary is always written as `js-runtime` regardless of runtime,
// so lib.rs and the rest of the build don't need to change. Node.js works as
// a drop-in for Bun for our adapter-node SvelteKit output.
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

const [,, nodePlatform, nodeArch, runtimeArg] = process.argv;
const runtime = (runtimeArg || 'bun').toLowerCase();
if (!['bun', 'node'].includes(runtime)) {
  console.error(`❌  Unknown runtime: ${runtime} (must be 'bun' or 'node')`);
  process.exit(1);
}

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

// Copy the Bun binary into build/ so it's included in the 'build' resource
// This avoids needing a separate resource entry and sidesteps linuxdeploy ldd.
function copyToBuildDir(binPath, isWin) {
  const buildDir = join(root, 'build');
  const ext = isWin ? '.exe' : '';
  const dest = join(buildDir, `js-runtime${ext}`);
  mkdirSync(buildDir, { recursive: true });
  if (isWin) {
    execSync(`copy /Y "${binPath}" "${dest}"`, { stdio: 'inherit', shell: true });
  } else {
    execSync(`cp "${binPath}" "${dest}"`, { stdio: 'inherit' });
    // Do NOT set +x here — Tauri moves executable resources to MacOS/ on macOS.
    // lib.rs sets +x at runtime before spawning.
    chmodSync(dest, 0o644);
  }
  console.log(`✅  Copied to build/js-runtime${ext}`);
}

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

// Map platform+arch → Node.js download asset suffix
const nodeAssetMap = {
  'darwin-arm64': 'darwin-arm64',
  'darwin-x64':   'darwin-x64',
  'linux-x64':    'linux-x64',
  'linux-arm64':  'linux-arm64',
  'win-x64':      'win-x64',
  'win-arm64':    'win-arm64',
};

const NODE_VERSION = process.version.replace(/^v/, ''); // match the host Node

async function downloadNode(platform, arch) {
  const assetKey = `${platform}-${arch}`;
  const assetSuffix = nodeAssetMap[assetKey];
  if (!assetSuffix) throw new Error(`No Node asset for ${assetKey}`);

  const isWindows = platform === 'win';
  const ext = isWindows ? 'zip' : 'tar.xz';
  const baseName = `node-v${NODE_VERSION}-${assetSuffix}`;
  const url = `https://nodejs.org/dist/v${NODE_VERSION}/${baseName}.${ext}`;
  console.log(`    ${assetKey} (node v${NODE_VERSION}): ${url}`);

  const archivePath = join(destDir, `_node-${assetKey}.${ext}`);
  const tmpDir = join(destDir, `_node-${assetKey}-tmp`);

  const res = await download(url);
  await saveToFile(res, archivePath);

  mkdirSync(tmpDir, { recursive: true });

  if (isWindows) {
    execSync(
      `powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${tmpDir}' -Force"`,
      { stdio: 'inherit' }
    );
  } else {
    execSync(`tar -xJf "${archivePath}" -C "${tmpDir}"`, { stdio: 'inherit' });
  }

  const nodeBin = isWindows
    ? join(tmpDir, baseName, 'node.exe')
    : join(tmpDir, baseName, 'bin', 'node');

  rmSync(archivePath, { force: true });
  return { binPath: nodeBin, tmpDir };
}

async function downloadRuntime(platform, arch) {
  return runtime === 'node'
    ? downloadNode(platform, arch)
    : downloadBun(platform, arch);
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

// ── Universal macOS: Tauri lipo's the slices itself — just provide both ───
// When building universal-apple-darwin, Tauri compiles aarch64 and x86_64
// separately and expects individual sidecar binaries for each triple.
if (nodePlatform === 'darwin' && nodeArch === 'universal') {
  console.log('📦  Downloading Bun binaries for universal macOS build (arm64 + x64)...');

  const paths = {};
  for (const [arch, triple] of [['arm64', 'aarch64-apple-darwin'], ['x64', 'x86_64-apple-darwin']]) {
    const destPath = join(destDir, `js-runtime-${triple}`);
    const { binPath, tmpDir } = await downloadBun('darwin', arch);
    renameSync(binPath, destPath);
    chmodSync(destPath, 0o755);
    rmSync(tmpDir, { recursive: true, force: true });
    paths[triple] = destPath;
    const sizeMB = (statSync(destPath).size / 1024 / 1024).toFixed(0);
    console.log(`✅  js-runtime-${triple} (${sizeMB}MB)`);
  }

  // Create universal binary via lipo
  const universalPath = join(destDir, 'js-runtime-universal-apple-darwin');
  execSync(
    `lipo -create "${paths['aarch64-apple-darwin']}" "${paths['x86_64-apple-darwin']}" -output "${universalPath}"`,
    { stdio: 'inherit' }
  );
  chmodSync(universalPath, 0o755);
  copyToBuildDir(universalPath, false);
  const sizeMB = (statSync(universalPath).size / 1024 / 1024).toFixed(0);
  console.log(`✅  js-runtime-universal-apple-darwin (${sizeMB}MB)`);
  process.exit(0);
}

// ── Single platform ────────────────────────────────────────────────────────
const destName = `js-runtime-${triple}${suffix}`;
const destPath = join(destDir, destName);

console.log(`📦  Downloading ${runtime} for ${key} → ${triple}`);

const { binPath, tmpDir } = await downloadRuntime(nodePlatform, nodeArch);
renameSync(binPath, destPath);
rmSync(tmpDir, { recursive: true, force: true });

if (!isWin) chmodSync(destPath, 0o755);

// Copy into build/ so it's available during dev / smoke test
copyToBuildDir(destPath, isWin);

const sizeMB = (statSync(destPath).size / 1024 / 1024).toFixed(0);
console.log(`✅  Sidecar ready: ${destName} (${runtime}, ${sizeMB}MB)`);

// Write artifact path to GITHUB_ENV if in CI
const envFile = process.env.GITHUB_ENV;
if (envFile) {
  const { appendFileSync } = await import('fs');
  appendFileSync(envFile, '');
}
