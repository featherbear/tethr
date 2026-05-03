/**
 * set-version.mjs — derive app version from git tag at build time
 *
 * Priority:
 *   1. Git tag on HEAD exactly (e.g. v0.2.1 → "0.2.1")
 *   2. Nearest ancestor tag, stripped to X.Y.Z (e.g. v0.2.1-3-gabcdef → "0.2.1")
 *   3. Fallback: "0.0.0"
 *
 * Updates:
 *   - package.json
 *   - src-tauri/tauri.conf.json
 *   - src-tauri/Cargo.toml
 *
 * Run automatically as part of `pnpm build`.
 */

import { execSync }                   from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath }              from 'node:url';
import { join, dirname }              from 'node:path';

// ---------------------------------------------------------------------------
// Resolve version
// ---------------------------------------------------------------------------

function gitVersion() {
  try {
    const raw = execSync('git describe --tags --abbrev=0', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'], // suppress stderr on all platforms
    }).trim();
    // Strip leading 'v' and any pre-release suffix to get clean X.Y.Z
    const match = raw.match(/^v?(\d+\.\d+\.\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

const version = gitVersion() ?? '0.0.0';
console.log(`[set-version] ${version}`);

// Use fileURLToPath + import.meta.url for Windows-safe path resolution.
// import.meta.url is always the script file's URL regardless of CWD.
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

// ---------------------------------------------------------------------------
// Update package.json
// ---------------------------------------------------------------------------

const pkgPath = join(rootDir, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.version = version;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

// ---------------------------------------------------------------------------
// Update src-tauri/tauri.conf.json
// ---------------------------------------------------------------------------

const tauriConfPath = join(rootDir, 'src-tauri', 'tauri.conf.json');
const tauriConf = JSON.parse(readFileSync(tauriConfPath, 'utf8'));
tauriConf.version = version;
writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n');

// ---------------------------------------------------------------------------
// Update src-tauri/Cargo.toml
// ---------------------------------------------------------------------------

const cargoPath = join(rootDir, 'src-tauri', 'Cargo.toml');
const cargo = readFileSync(cargoPath, 'utf8');
writeFileSync(cargoPath, cargo.replace(/^version = ".*"/m, `version = "${version}"`));
