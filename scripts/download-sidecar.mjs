#!/usr/bin/env node
/**
 * download-sidecar.mjs — download the JS runtime (Bun or Node) for the target platform
 * and write it directly to src-tauri/binaries/js-runtime (no arch suffix).
 *
 * Usage:
 *   node scripts/download-sidecar.mjs <platform> <arch> [runtime]
 *
 *   platform: darwin | linux | win
 *   arch:     x64 | arm64 | universal
 *   runtime:  bun (default) | node
 *
 * macOS universal:
 *   Downloads both arm64 and x64 Bun binaries and merges them with `lipo`
 *   into a fat binary that runs natively on both Apple Silicon and Intel.
 *
 * Output:
 *   src-tauri/binaries/js-runtime  (executable, chmod 755 on non-Windows)
 *   build/js-runtime               (copy for dev server / smoke tests)
 *
 * In CI, writes SIDECAR_PATH to GITHUB_ENV.
 */

import { createWriteStream, mkdirSync, chmodSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname }    from 'node:path';
import { fileURLToPath }    from 'node:url';
import { get }              from 'node:https';
import { execSync }         from 'node:child_process';
import { tmpdir }           from 'node:os';
import { randomBytes }      from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root      = join(__dirname, '..');
const binDir    = join(root, 'src-tauri', 'binaries', 'runtime');

mkdirSync(binDir, { recursive: true });

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const [nodePlatform = 'darwin', nodeArch = 'arm64', runtime = 'bun'] = process.argv.slice(2);

const isWin = nodePlatform === 'win';
// Use .exe on Windows — binaries/runtime/ is mapped as a folder in tauri.conf.json
// so Tauri copies whatever is inside without inspecting filenames.
const outName = isWin ? 'js-runtime.exe' : 'js-runtime';
const outPath = join(binDir, outName);

console.log(`[download-sidecar] platform=${nodePlatform} arch=${nodeArch} runtime=${runtime}`);

// ---------------------------------------------------------------------------
// Download helpers
// ---------------------------------------------------------------------------

/** Download a URL to a temp file, return the file path. */
function download(url, destPath) {
  return new Promise((resolve, reject) => {
    console.log(`  ↓ ${url}`);
    function request(u) {
      get(u, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return request(res.headers.location);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${u}`));
        }
        const out = createWriteStream(destPath);
        res.pipe(out);
        out.on('finish', () => { out.close(); resolve(destPath); });
        out.on('error', reject);
      }).on('error', reject);
    }
    request(url);
  });
}

function tmpFile(suffix = '') {
  return join(tmpdir(), `sidecar-${randomBytes(4).toString('hex')}${suffix}`);
}

// ---------------------------------------------------------------------------
// Bun download URLs
// ---------------------------------------------------------------------------

const BUN_VERSION = '1.2.13';

const bunUrlMap = {
  'darwin-arm64':   `https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-darwin-aarch64.zip`,
  'darwin-x64':     `https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-darwin-x64-baseline.zip`,
  'linux-x64':      `https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-x64-baseline.zip`,
  'linux-arm64':    `https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-aarch64.zip`,
  'win-x64':        `https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-windows-x64-baseline.zip`,
  'win-arm64':      `https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-windows-x64-baseline.zip`, // no native arm64 bun yet
};

const bunBinaryInZip = {
  'darwin-arm64':   'bun-darwin-aarch64/bun',
  'darwin-x64':     'bun-darwin-x64-baseline/bun',
  'linux-x64':      'bun-linux-x64-baseline/bun',
  'linux-arm64':    'bun-linux-aarch64/bun',
  'win-x64':        'bun-windows-x64-baseline/bun.exe',
  'win-arm64':      'bun-windows-x64-baseline/bun.exe',
};

// ---------------------------------------------------------------------------
// Node.js download URLs
// ---------------------------------------------------------------------------

const NODE_VERSION = process.version.replace(/^v/, '');

const nodeUrlMap = {
  'linux-x64':   `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz`,
  'linux-arm64': `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-arm64.tar.xz`,
};

// ---------------------------------------------------------------------------
// Extract a single file from a zip archive (cross-platform via node:zlib + unzip CLI)
// ---------------------------------------------------------------------------

async function extractFromZip(zipPath, entryName, destPath) {
  // Try system unzip first (fast, available on macOS/Linux/Windows CI)
  try {
    if (isWin) {
      execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${dirname(destPath)}' -Force"`, { stdio: 'pipe' });
      // PowerShell extracts the whole zip; find the file
      const extracted = join(dirname(destPath), entryName.replace(/\//g, '\\'));
      if (existsSync(extracted)) {
        copyFileSync(extracted, destPath);
        return;
      }
    } else {
      execSync(`unzip -p "${zipPath}" "${entryName}" > "${destPath}"`, { stdio: 'pipe', shell: true });
      return;
    }
  } catch { /* fall through */ }
  throw new Error(`Could not extract ${entryName} from ${zipPath}`);
}

// ---------------------------------------------------------------------------
// Download a single arch Bun binary, return path to the extracted executable
// ---------------------------------------------------------------------------

async function downloadBun(platform, arch) {
  const key = `${platform}-${arch}`;
  const url = bunUrlMap[key];
  if (!url) throw new Error(`No Bun URL for ${key}`);
  const entry = bunBinaryInZip[key];

  const zipPath = tmpFile('.zip');
  await download(url, zipPath);

  // Temp file uses .exe on Windows for correct PE extraction, but final output is always js-runtime
  const extractedPath = tmpFile(isWin ? '.exe' : '');
  await extractFromZip(zipPath, entry, extractedPath);
  if (!isWin) chmodSync(extractedPath, 0o755);
  return extractedPath;
}

// ---------------------------------------------------------------------------
// Download Node.js binary, return path to the extracted node executable
// ---------------------------------------------------------------------------

async function downloadNode(platform, arch) {
  const key = `${platform}-${arch}`;
  const url = nodeUrlMap[key];
  if (!url) throw new Error(`No Node URL for ${key}`);

  const tarPath = tmpFile('.tar.xz');
  await download(url, tarPath);

  const extractDir = tmpFile('-dir');
  mkdirSync(extractDir, { recursive: true });
  // GNU tar (Linux) requires --wildcards for glob patterns; BSD tar (macOS) supports them by default.
  // We try GNU tar first with --wildcards, fall back to BSD tar without it.
  try {
    execSync(`tar -xJf "${tarPath}" -C "${extractDir}" --wildcards --strip-components=2 "*/bin/node"`, { stdio: 'pipe' });
  } catch {
    execSync(`tar -xJf "${tarPath}" -C "${extractDir}" --strip-components=2 "*/bin/node"`, { stdio: 'pipe' });
  }
  const nodeBin = join(extractDir, 'node');
  chmodSync(nodeBin, 0o755);
  return nodeBin;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  let finalBin;

  if (nodePlatform === 'darwin' && nodeArch === 'universal') {
    // macOS universal: download arm64 + x64, merge with lipo
    console.log('[download-sidecar] Building macOS universal binary with lipo...');
    const [arm64, x64] = await Promise.all([
      downloadBun('darwin', 'arm64'),
      downloadBun('darwin', 'x64'),
    ]);
    const lipoOut = tmpFile();
    execSync(`lipo -create -output "${lipoOut}" "${arm64}" "${x64}"`, { stdio: 'inherit' });
    chmodSync(lipoOut, 0o755);
    finalBin = lipoOut;
    console.log('[download-sidecar] lipo merge complete');
  } else if (runtime === 'node') {
    finalBin = await downloadNode(nodePlatform, nodeArch);
  } else {
    finalBin = await downloadBun(nodePlatform, nodeArch);
  }

  // Write to src-tauri/binaries/js-runtime (no arch suffix)
  copyFileSync(finalBin, outPath);
  if (!isWin) chmodSync(outPath, 0o755);

  // Ad-hoc code sign on macOS — suppresses the firewall "new app" dialog
  // without requiring an Apple Developer certificate.
  if (nodePlatform === 'darwin') {
    try {
      execSync(`codesign --force --deep --sign - "${outPath}"`, { stdio: 'pipe' });
      console.log('[download-sidecar] ad-hoc signed js-runtime');
    } catch (e) {
      console.warn('[download-sidecar] codesign failed (non-fatal):', e.message);
    }
  }

  const sizeMB = (statSync(outPath).size / 1024 / 1024).toFixed(0);
  console.log(`✅ js-runtime ready: ${outPath} (${sizeMB}MB)`);

  // Export to GITHUB_ENV if in CI
  const envFile = process.env.GITHUB_ENV;
  if (envFile) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(envFile, `SIDECAR_PATH=${outPath}\n`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
