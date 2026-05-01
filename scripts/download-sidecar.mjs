#!/usr/bin/env node
// download-sidecar.mjs — Download the correct Node.js binary for the target
// platform/arch and place it in src-tauri/binaries/ with the Tauri triple suffix.
//
// Usage: node scripts/download-sidecar.mjs <platform> <arch>
//   platform: darwin | linux | win
//   arch:     x64 | arm64
//
// Used in CI to get the right binary when cross-compiling (e.g. building
// x86_64 macOS on an arm64 runner). Uses only Node built-ins — no npm deps.

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
  process.exit(1);
}

// Map platform+arch → Rust triple
const tripleMap = {
  'darwin-arm64':     'aarch64-apple-darwin',
  'darwin-x64':       'x86_64-apple-darwin',
  'darwin-universal': 'universal-apple-darwin', // handled separately below
  'linux-x64':        'x86_64-unknown-linux-gnu',
  'linux-arm64':      'aarch64-unknown-linux-gnu',
  'win-x64':          'x86_64-pc-windows-msvc',
  'win-arm64':        'aarch64-pc-windows-msvc',
};

const key = `${nodePlatform}-${nodeArch}`;
const triple = tripleMap[key];
if (!triple) {
  console.error(`❌  Unknown platform/arch combination: ${key}`);
  process.exit(1);
}

const nodeVersion = process.version.replace(/^v/, '');
const isWin = nodePlatform === 'win';
const suffix = isWin ? '.exe' : '';

// Handle universal macOS build — download both arm64 and x64, lipo together
if (nodePlatform === 'darwin' && nodeArch === 'universal') {
  const arm64Path = join(destDir, 'node-server-aarch64-apple-darwin');
  const x64Path   = join(destDir, 'node-server-x86_64-apple-darwin');
  const destPath  = join(destDir, 'node-server-universal-apple-darwin');

  mkdirSync(destDir, { recursive: true });
  console.log('📦  Downloading Node.js binaries for universal macOS build...');

  for (const [arch, outPath] of [['arm64', arm64Path], ['x64', x64Path]]) {
    const url = `https://nodejs.org/dist/v${nodeVersion}/node-v${nodeVersion}-darwin-${arch}.tar.gz`;
    console.log(`    ${arch}: ${url}`);
    const res = await download(url);
    const tarPath = outPath + '.tar';
    const tmpDir  = outPath + '-tmp';
    await saveToFile(res.pipe(createGunzip()), tarPath);
    mkdirSync(tmpDir, { recursive: true });
    execSync(`tar -xf "${tarPath}" -C "${tmpDir}" "node-v${nodeVersion}-darwin-${arch}/bin/node"`, { stdio: 'inherit' });
    renameSync(join(tmpDir, `node-v${nodeVersion}-darwin-${arch}`, 'bin', 'node'), outPath);
    chmodSync(outPath, 0o755);
    rmSync(tarPath, { force: true });
    rmSync(tmpDir, { recursive: true, force: true });
  }

  execSync(`lipo -create "${arm64Path}" "${x64Path}" -output "${destPath}"`, { stdio: 'inherit' });
  rmSync(arm64Path, { force: true });
  rmSync(x64Path,   { force: true });

  const { statSync } = await import('fs');
  const sizeMB = (statSync(destPath).size / 1024 / 1024).toFixed(0);
  console.log(`✅  Sidecar ready: node-server-universal-apple-darwin (${sizeMB}MB)`);

  const envFile = process.env.GITHUB_ENV;
  if (envFile) { const { appendFileSync } = await import('fs'); appendFileSync(envFile, ''); }
  process.exit(0);
}

const destName = `node-server-${triple}${suffix}`;
const destPath = join(destDir, destName);

mkdirSync(destDir, { recursive: true });

console.log(`📦  Downloading Node.js v${nodeVersion} for ${key} → ${triple}`);

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

// Save a stream to a file
function saveToFile(stream, filePath) {
  return new Promise((resolve, reject) => {
    const out = createWriteStream(filePath);
    stream.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
  });
}

if (isWin) {
  // Windows: download zip, extract node.exe using PowerShell Expand-Archive
  const url = `https://nodejs.org/dist/v${nodeVersion}/node-v${nodeVersion}-win-${nodeArch}.zip`;
  console.log(`    URL: ${url}`);

  const zipPath = join(destDir, '_node-tmp.zip');
  const tmpDir  = join(destDir, '_node-tmp');

  const res = await download(url);
  await saveToFile(res, zipPath);

  execSync(
    `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${tmpDir}' -Force"`,
    { stdio: 'inherit' }
  );

  const subDir = readdirSync(tmpDir).find(d => d.startsWith('node-'));
  renameSync(join(tmpDir, subDir, 'node.exe'), destPath);

  rmSync(zipPath, { force: true });
  rmSync(tmpDir, { recursive: true, force: true });

} else {
  // macOS / Linux: download tar.gz to temp file, extract with system tar
  const url = `https://nodejs.org/dist/v${nodeVersion}/node-v${nodeVersion}-${nodePlatform}-${nodeArch}.tar.gz`;
  console.log(`    URL: ${url}`);

  const tarPath = join(destDir, '_node-tmp.tar.gz');
  const tmpDir  = join(destDir, '_node-tmp');

  const res = await download(url);
  // Decompress gzip and save raw tar
  await saveToFile(res.pipe(createGunzip()), tarPath.replace('.gz', ''));

  mkdirSync(tmpDir, { recursive: true });

  // Use system tar to extract just the node binary (works on macOS + Linux)
  const tarEntry = `node-v${nodeVersion}-${nodePlatform}-${nodeArch}/bin/node`;
  execSync(`tar -xf "${tarPath.replace('.gz', '')}" -C "${tmpDir}" "${tarEntry}"`, {
    stdio: 'inherit'
  });

  renameSync(join(tmpDir, ...tarEntry.split('/')), destPath);
  chmodSync(destPath, 0o755);

  rmSync(tarPath.replace('.gz', ''), { force: true });
  rmSync(tmpDir, { recursive: true, force: true });
}

const sizeMB = (statSync(destPath).size / 1024 / 1024).toFixed(0);
console.log(`✅  Sidecar ready: ${destName} (${sizeMB}MB)`);
