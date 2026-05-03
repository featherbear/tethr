#!/usr/bin/env node
// package-artifact.mjs — Find the Tauri build output, rename it with consistent
// naming, and print the path to stdout for use in CI.
//
// Usage: node scripts/package-artifact.mjs <label> <tag> [rust-target]
//   label:       e.g. macos-arm64, linux-x86_64, windows-x86_64
//   tag:         e.g. v0.1.0
//   rust-target: e.g. aarch64-apple-darwin (optional, for cross-compiled macOS)

import { execSync } from 'child_process';
import { readdirSync, renameSync, statSync, existsSync } from 'fs';
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
  // Windows: --no-bundle build — Tauri places tethr.exe + resources/ in target/release/.
  // Create a self-extracting archive (SFX) using 7-Zip.
  const targetSuffix = process.argv[4] ? process.argv[4] + '\\' : '';
  const releaseDir   = join(root, 'src-tauri', 'target', targetSuffix + 'release');
  const tethrExe     = join(releaseDir, 'tethr.exe');
  const resourcesDir = join(releaseDir, 'resources');
  // Verify runtime binary exists (js-runtime.exe — staged in build/runtime/)
  const runtimeExe = join(resourcesDir, 'build', 'runtime', 'js-runtime.exe');
  if (!existsSync(runtimeExe)) throw new Error(`js-runtime.exe not found at ${runtimeExe}`);

  if (!existsSync(tethrExe))     throw new Error(`tethr.exe not found at ${tethrExe}`);
  if (!existsSync(resourcesDir)) throw new Error(`resources/ not found at ${resourcesDir}`);

  dest = join(root, `tethr-${tag}-${label}.exe`);

  // Self-extracting archive using 7-Zip SFX.
  // 7zSD.sfx is not pre-installed — download it from 7-Zip releases.
  const sevenZip  = 'C:\\Program Files\\7-Zip\\7z.exe';
  const sfxStub   = join(root, 'tmp-7zSD.sfx');
  const archiveZip = join(root, 'tmp-tethr.7z');
  const sfxConfig = join(root, 'tmp-sfx-config.txt');

  // Download 7zSD.sfx (console SFX module — works without GUI)
  execSync(
    `powershell -Command "Invoke-WebRequest -Uri 'https://github.com/ip7z/7zip/releases/download/24.09/7z2409-extra.7z' -OutFile 'tmp-7zextra.7z'"`,
    { stdio: 'inherit' }
  );
  execSync(`"${sevenZip}" e tmp-7zextra.7z 7zSD.sfx -o"${join(root)}" -y`, { stdio: 'inherit' });

  // SFX config: extract to %TEMP%\tethr-{tag} and run tethr.exe
  const sfxConfigContent = [
    ';!@Install@!UTF-8!',
    'Title="Tethr"',
    `ExtractPath="%TEMP%\\tethr-${tag}"`,
    'RunProgram="tethr.exe"',
    ';!@InstallEnd@!',
  ].join('\r\n');
  const { writeFileSync } = await import('fs');
  writeFileSync(sfxConfig, sfxConfigContent, 'utf8');

  // Create 7z archive from the release dir so tethr.exe + resources/ are at root
  execSync(`"${sevenZip}" a -mx=5 "${archiveZip}" -w"${releaseDir}" tethr.exe resources`, { stdio: 'inherit', cwd: releaseDir });

  // Concatenate: SFX stub + config + archive → self-extracting exe
  execSync(
    `powershell -Command "` +
    `$sfx=[IO.File]::ReadAllBytes('${sfxStub}');` +
    `$cfg=[Text.Encoding]::UTF8.GetBytes([IO.File]::ReadAllText('${sfxConfig}'));` +
    `$arc=[IO.File]::ReadAllBytes('${archiveZip}');` +
    `$s=New-Object IO.FileStream('${dest}',[IO.FileMode]::Create);` +
    `$s.Write($sfx,0,$sfx.Length);$s.Write($cfg,0,$cfg.Length);$s.Write($arc,0,$arc.Length);$s.Close()"`,
    { stdio: 'inherit' }
  );

  // Cleanup temp files
  for (const f of [sfxStub, archiveZip, sfxConfig, join(root, 'tmp-7zextra.7z')]) {
    try { execSync(`del /f "${f}"`, { stdio: 'pipe', shell: true }); } catch {}
  }
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
