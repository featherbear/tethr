#!/usr/bin/env node
/**
 * install-prod-deps.mjs — Install production npm dependencies into server_modules/node_modules
 * so the Tauri sidecar (Bun/Node runtime) can resolve them at runtime.
 *
 * Run automatically via the "postbuild" script in package.json.
 * Safe to run multiple times (idempotent).
 *
 * Auto-detects which packages are needed by scanning the build/server/ output
 * for ESM imports that are not:
 *   - relative paths (./  ../)    — bundled by Vite
 *   - node: builtins              — available natively
 *   - virtual SvelteKit paths     — $app/*, $lib/* (bundled by Vite)
 *   - TypeScript type-only        — @types/*, types
 *   - Internal spec paths         — @standard-schema/*
 *
 * Install into server_modules/ (not build/node_modules/) to avoid Tauri's
 * frontendDist scan rejecting node_modules inside the build directory.
 * Tauri resources map server_modules/ → build/node_modules/ inside the .app.
 */

import { execSync }                                         from 'node:child_process';
import { writeFileSync, rmSync, readFileSync, mkdirSync,
         readdirSync, statSync }                            from 'node:fs';
import { join, dirname }                                    from 'node:path';
import { fileURLToPath }                                    from 'node:url';

const root        = join(dirname(fileURLToPath(import.meta.url)), '..');
const buildServer = join(root, 'build', 'server');
const serverMod   = join(root, 'server_modules');
const pkgPath     = join(serverMod, 'package.json');

// ---------------------------------------------------------------------------
// Auto-detect external imports from build/server/**/*.js
// ---------------------------------------------------------------------------

const SKIP_PREFIXES = [
  '.', '/', 'node:', '$app/', '$lib/', '$env/',
  '@types/', '@standard-schema/',
  // these are type-only at runtime or bundled
  'esm-env',
];
// SvelteKit internal virtual modules
const SKIP_EXACT = new Set(['types', '@sveltejs/kit', 'esm-env', '@standard-schema/spec']);

function isSkipped(id) {
  if (SKIP_EXACT.has(id)) return true;
  return SKIP_PREFIXES.some(p => id.startsWith(p));
}

function scanDir(dir) {
  const results = new Set();
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return results; }

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const r of scanDir(full)) results.add(r);
    } else if (entry.name.endsWith('.js')) {
      const src = readFileSync(full, 'utf8');
      // Match: from "pkg" or from 'pkg'
      const re = /from\s+["']([^"'.][^"']*?)["']/g;
      let m;
      while ((m = re.exec(src)) !== null) {
        const id = m[1];
        if (!isSkipped(id)) {
          // Extract top-level package name (handle @scope/pkg)
          const pkg = id.startsWith('@')
            ? id.split('/').slice(0, 2).join('/')
            : id.split('/')[0];
          results.add(pkg);
        }
      }
    }
  }
  return results;
}

const detected = [...scanDir(buildServer)].sort();
console.log('[install-prod-deps] Detected server deps:', detected);

// Ensure critical runtime deps are always included even if Rollup bundled them
// on the current platform (making them invisible to the ESM import scanner).
const ALWAYS_INCLUDE = ['pino', 'undici'];
const allDepsToInstall = [...new Set([...detected, ...ALWAYS_INCLUDE])].sort();
console.log('[install-prod-deps] Final deps (detected + required):', allDepsToInstall);

// ---------------------------------------------------------------------------
// Resolve versions from root package.json
// ---------------------------------------------------------------------------

const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const allDeps = { ...rootPkg.dependencies, ...rootPkg.devDependencies };

const versions = {};
const missing = [];
for (const dep of allDepsToInstall) {
  if (allDeps[dep]) {
    versions[dep] = allDeps[dep];
  } else {
    missing.push(dep);
  }
}

if (missing.length > 0) {
  console.warn('[install-prod-deps] ⚠️  Packages not in package.json (will be skipped):', missing);
}

// ---------------------------------------------------------------------------
// Install into server_modules/
// ---------------------------------------------------------------------------

mkdirSync(serverMod, { recursive: true });

writeFileSync(pkgPath, JSON.stringify({
  name: 'tethr-server',
  version: '0.0.0',
  private: true,
  type: 'module',
  dependencies: versions,
}, null, 2));

// Use npm (not pnpm) — flat copy-safe layout without symlinks that break
// when Tauri copies resources into the .app bundle.
console.log('[install-prod-deps] Installing into server_modules/ (via npm)...');
execSync('npm install --omit=dev --ignore-scripts', {
  cwd: serverMod,
  stdio: 'inherit',
});
rmSync(pkgPath, { force: true });
rmSync(join(serverMod, 'package-lock.json'), { force: true });

console.log('[install-prod-deps] Done ✓');
