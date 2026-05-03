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

// ---------------------------------------------------------------------------
// Resolve version
// ---------------------------------------------------------------------------

function gitVersion() {
  try {
    const raw = execSync('git describe --tags --abbrev=0 2>/dev/null', { encoding: 'utf8' }).trim();
    // Strip leading 'v' and any pre-release suffix to get clean X.Y.Z
    const match = raw.match(/^v?(\d+\.\d+\.\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

const version = gitVersion() ?? '0.0.0';
console.log(`[set-version] ${version}`);

// ---------------------------------------------------------------------------
// Update package.json
// ---------------------------------------------------------------------------

const pkgPath = new URL('../package.json', import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.version = version;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

// ---------------------------------------------------------------------------
// Update src-tauri/tauri.conf.json
// ---------------------------------------------------------------------------

const tauriConfPath = new URL('../src-tauri/tauri.conf.json', import.meta.url).pathname;
const tauriConf = JSON.parse(readFileSync(tauriConfPath, 'utf8'));
tauriConf.version = version;
writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n');

// ---------------------------------------------------------------------------
// Update src-tauri/Cargo.toml
// ---------------------------------------------------------------------------

const cargoPath = new URL('../src-tauri/Cargo.toml', import.meta.url).pathname;
const cargo = readFileSync(cargoPath, 'utf8');
writeFileSync(cargoPath, cargo.replace(/^version = ".*"/m, `version = "${version}"`));
