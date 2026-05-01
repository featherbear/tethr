#!/usr/bin/env node
// setup-sidecar.mjs — Set up the Node.js sidecar for the current (native) platform.
//
// Delegates to download-sidecar.mjs with the current platform/arch.
// Run via: pnpm sidecar  (or node scripts/setup-sidecar.mjs)

import { execSync } from 'child_process';
import { platform, arch } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Map os.platform() / os.arch() to nodejs.org download identifiers
const platformMap = { darwin: 'darwin', linux: 'linux', win32: 'win' };
const archMap = { x64: 'x64', arm64: 'arm64' };

const nodePlatform = platformMap[platform()];
const nodeArch = archMap[arch()];

if (!nodePlatform || !nodeArch) {
  console.error(`❌  Unsupported platform: ${platform()} ${arch()}`);
  process.exit(1);
}

const script = join(__dirname, 'download-sidecar.mjs');
execSync(`node "${script}" ${nodePlatform} ${nodeArch}`, { stdio: 'inherit' });
