#!/usr/bin/env node
// package-artifact.mjs — Find the Tauri build output, rename it with consistent
// naming, and print the path to stdout for use in CI.
//
// Usage: node scripts/package-artifact.mjs <label> <tag> [rust-target]
//   label:       e.g. macos-arm64, linux-x86_64, windows-x86_64
//   tag:         e.g. v0.1.0
//   rust-target: e.g. aarch64-apple-darwin (optional, for cross-compiled macOS)

import { execSync } from 'child_process';
import { readdirSync, renameSync, statSync, existsSync, writeFileSync } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import { platform } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const [,, label, tag, rustTarget] = process.argv;
if (!label || !tag) {
  console.error('Usage: node package-artifact.mjs <label> <tag> [rust-target]');
  process.exit(1);
}

const os = platform();
// For universal-apple-darwin, Tauri outputs to universal-apple-darwin/release/bundle
// For native targets (linux, windows), output is at release/bundle
const bundleBase = join(root, 'src-tauri', 'target',
  rustTarget ? join(rustTarget, 'release', 'bundle') : join('release', 'bundle')
);

let src, ext, dest;

if (os === 'darwin') {
  // macOS: zip the .app bundle with ditto (preserves permissions + symlinks)
  const appPath = join(bundleBase, 'macos', 'tethr.app');
  dest = join(root, `tethr-${tag}-${label}.zip`);
  execSync(`ditto -c -k --keepParent "${appPath}" "${dest}"`, { stdio: 'inherit' });
} else if (os === 'linux') {
  // Linux: prefer AppImage, fall back to deb
  const appimageDir = join(bundleBase, 'appimage');
  const debDir = join(bundleBase, 'deb');
  let appImage = null;
  try { appImage = readdirSync(appimageDir).find(f => f.endsWith('.AppImage')); } catch {}
  if (appImage) {
    dest = join(root, `tethr-${tag}-${label}.AppImage`);
    renameSync(join(appimageDir, appImage), dest);
  } else {
    const deb = readdirSync(debDir).find(f => f.endsWith('.deb'));
    if (!deb) throw new Error('No .AppImage or .deb found in bundle output');
    dest = join(root, `tethr-${tag}-${label}.deb`);
    renameSync(join(debDir, deb), dest);
  }
} else if (os === 'win32') {
  // Windows: create a self-extracting archive (SFX) using 7-Zip.
  // The SFX exe extracts tethr.exe + resources/ to a temp dir and launches tethr.exe.
  // No installation, no admin rights, no UAC prompt.
  const releaseDir   = join(root, 'src-tauri', 'target', 'release');
  const tethrExe     = join(releaseDir, 'tethr.exe');
  const resourcesDir = join(releaseDir, 'resources');

  if (!existsSync(tethrExe))     throw new Error(`tethr.exe not found at ${tethrExe}`);
  if (!existsSync(resourcesDir)) throw new Error(`resources/ not found at ${resourcesDir}`);

  const tmpDir    = join(root, 'tmp-sfx');
  const archivePath = join(tmpDir, 'tethr.7z');
  const configPath  = join(tmpDir, 'sfx-config.txt');
  const sfxStub     = 'C:\\Program Files\\7-Zip\\7zSD.sfx';
  dest = join(root, `tethr-${tag}-${label}.exe`);

  // Create temp working dir
  execSync(`powershell -Command "New-Item -ItemType Directory -Force -Path '${tmpDir}'"`, { stdio: 'pipe' });

  // SFX config — extracts to %TEMP%\tethr and runs tethr.exe
  const sfxConfig = `;!@Install@!UTF-8!\nTitle="Tethr"\nRunProgram="tethr.exe"\n;!@InstallEnd@!`;
  writeFileSync(configPath, sfxConfig, 'utf8');

  // Create 7z archive of tethr.exe + resources/
  const sevenZip = 'C:\\Program Files\\7-Zip\\7z.exe';
  execSync(`"${sevenZip}" a -mx=5 "${archivePath}" "${tethrExe}" "${resourcesDir}"`, { stdio: 'inherit' });

  // Concatenate SFX stub + config + archive → self-extracting exe
  execSync(
    `powershell -Command "` +
    `$sfx = [System.IO.File]::ReadAllBytes('${sfxStub}'); ` +
    `$cfg = [System.Text.Encoding]::UTF8.GetBytes([System.IO.File]::ReadAllText('${configPath}')); ` +
    `$arc = [System.IO.File]::ReadAllBytes('${archivePath}'); ` +
    `$out = New-Object System.IO.FileStream('${dest}', [System.IO.FileMode]::Create); ` +
    `$out.Write($sfx, 0, $sfx.Length); ` +
    `$out.Write($cfg, 0, $cfg.Length); ` +
    `$out.Write($arc, 0, $arc.Length); ` +
    `$out.Close()"`,
    { stdio: 'inherit' }
  );

  // Cleanup temp dir
  execSync(`powershell -Command "Remove-Item -Recurse -Force '${tmpDir}'"`, { stdio: 'pipe' });
} else {
  console.error(`❌  Unsupported OS: ${os}`);
  process.exit(1);
}

const sizeMB = (statSync(dest).size / 1024 / 1024).toFixed(0);
console.log(`✅  Artifact: ${dest} (${sizeMB}MB)`);

// Write to GITHUB_ENV so the upload step can reference it
import { appendFileSync } from 'fs';
const envFile = process.env.GITHUB_ENV;
if (envFile) appendFileSync(envFile, `ARTIFACT=${dest}\n`);
