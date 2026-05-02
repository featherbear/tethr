#!/usr/bin/env node
// install-prod-deps.mjs — Install production npm dependencies into build/node_modules
// so the Tauri sidecar (Bun runtime) can resolve them without a separate node_modules dir.
//
// Run automatically via the "postbuild" script in package.json.
// Safe to run multiple times (idempotent).

import { execSync } from 'child_process';
import { writeFileSync, rmSync, readFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Install into server_modules/ (not build/node_modules) to avoid Tauri's
// frontendDist scan rejecting node_modules inside the build directory.
// Tauri resources map server_modules/ → build/node_modules inside the .app,
// so Bun can resolve deps from build/node_modules at runtime.
const buildDir = join(root, 'server_modules');
const pkgPath = join(buildDir, 'package.json');

// Packages actually imported by server-side code at runtime:
//   pino, pino-abstract-transport — logging
//   pino-pretty                   — dev pretty-printing (small; harmless in prod bundle)
//   undici                        — camera HTTP client (Agent for TLS bypass)
// @tauri-apps/* are client-side only (bundled by Vite into the browser chunks).
const SERVER_DEPS = ['pino', 'pino-abstract-transport', 'pino-pretty', 'undici'];

const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const versions = {};
for (const dep of SERVER_DEPS) {
  const v = rootPkg.dependencies?.[dep] ?? rootPkg.devDependencies?.[dep];
  if (!v) throw new Error(`Dependency "${dep}" not found in root package.json`);
  versions[dep] = v;
}

// Ensure the target directory exists
mkdirSync(buildDir, { recursive: true });

// Write a minimal package.json into server_modules/ for pnpm to install against
writeFileSync(pkgPath, JSON.stringify({
  name: 'tethr-server',
  version: '0.0.0',
  private: true,
  type: 'module',
  dependencies: versions,
}, null, 2));

// Use npm (not pnpm) so node_modules is a flat, copy-safe layout without symlinks.
// pnpm uses a virtual store with symlinks that break when Tauri copies resources into the .app.
console.log('[postbuild] Installing production deps into server_modules/ (via npm)...');
try {
  execSync('npm install --omit=dev --ignore-scripts', {
    cwd: buildDir,
    stdio: 'inherit',
  });
} finally {
  // Remove the temporary package.json and lockfile (keep node_modules)
  rmSync(pkgPath, { force: true });
  rmSync(join(buildDir, 'package-lock.json'), { force: true });
}

console.log('[postbuild] Production deps installed ✓');
