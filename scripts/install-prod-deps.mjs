#!/usr/bin/env node
// install-prod-deps.mjs — Install production npm dependencies into build/node_modules
// so the Tauri sidecar (Bun runtime) can resolve them without a separate node_modules dir.
//
// Run automatically via the "postbuild" script in package.json.
// Safe to run multiple times (idempotent).

import { execSync } from 'child_process';
import { writeFileSync, rmSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = join(root, 'build');
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

// Write a minimal package.json into build/ for pnpm to install against
writeFileSync(pkgPath, JSON.stringify({
  name: 'tethr-server',
  version: '0.0.0',
  private: true,
  type: 'module',
  dependencies: versions,
}, null, 2));

console.log('[postbuild] Installing production deps into build/node_modules...');
try {
  execSync('pnpm install --prod --prefer-offline --ignore-scripts', {
    cwd: buildDir,
    stdio: 'inherit',
  });
} finally {
  // Remove the temporary package.json (keep node_modules)
  rmSync(pkgPath, { force: true });
  rmSync(join(buildDir, 'pnpm-lock.yaml'), { force: true });
}

console.log('[postbuild] Production deps installed ✓');
