# tethr

A macOS desktop app that previews photos from a Canon EOS camera over WiFi — in real-time, as you shoot.

Built with **Tauri v2 + SvelteKit (Svelte 5)**, using the [Canon Camera Control API (CCAPI)](https://developercommunity.usa.canon.com/s/article/Introduction-to-Camera-Control-API-CCAPI).

---

## What it does

- **Real-time shot notification** — detects new photos the moment the shutter fires, via the CCAPI monitoring stream
- **Progressive image loading** — thumbnail loads instantly, full-resolution preview downloads in the background (newest shots first)
- **Photo grid** — scrollable grid with smooth entry animations, newest photos at the top
- **Lightbox** — click any photo to view it full-screen
- **Status bar** — live camera name, lens, shooting mode, aperture, shutter speed, ISO, battery level (numeric %), and card space remaining
- **Camera settings** — configure camera IP/port via a settings panel; validates the address is a real Canon camera before connecting
- **Auto-reconnect** — exponential backoff reconnect loop; automatically prompts for the camera address if no connection is established
- **Multi-camera support** — works with any Canon camera that supports CCAPI (tested on EOS R6 Mark II and EOS R50)

---

## Requirements

- macOS (Apple Silicon or Intel)
- Canon camera with CCAPI enabled, connected to the same WiFi network
- Node.js ≥ 18
- [pnpm](https://pnpm.io) (`npm install -g pnpm`)
- Rust + Cargo (via [rustup](https://rustup.rs)) — only needed for Tauri builds

---

## Dev setup

```bash
# Install dependencies
pnpm install

# Set up the Tauri sidecar (required for pnpm tauri build, not needed for pnpm dev)
pnpm sidecar

# Start the dev server (Vite, port 1420)
CCAPI_BASE_URL=http://<camera-ip>:8080 pnpm dev

# Start dev server with mock camera (auto-fires shots every 5s, no real camera needed)
pnpm dev:mock

# Open in Tauri window (runs pnpm dev automatically)
pnpm tauri dev
```

> **First run:** Open http://localhost:1420 in your browser, or use `pnpm tauri dev` for the native window. Enter your camera's IP address in the Settings panel (⚙ icon in the status bar).

---

## Available commands

| Command | Description |
|---|---|
| `pnpm dev` | Start Vite dev server on port 1420 |
| `pnpm dev:mock` | Start dev server + mock CCAPI camera |
| `pnpm mock` | Start mock CCAPI server only (port 8080) |
| `pnpm check` | TypeScript + Svelte type-check |
| `pnpm build` | Build SvelteKit output (`build/`) |
| `pnpm tauri dev` | Open Tauri native window (dev mode) |
| `pnpm tauri build` | Bundle production `.app` |
| `pnpm sidecar` | Copy Node binary into `src-tauri/binaries/` (required before `tauri build`) |

---

## Production build

The `.app` is fully self-contained — no external Node.js required:

```bash
pnpm tauri build
# Output: src-tauri/target/release/bundle/macos/tethr.app
```

At launch, Tauri spawns the bundled Node binary running the SvelteKit server on `localhost:3000`, waits for it to be ready, then opens the WebView window.

---

## Tech stack

| Layer | Technology |
|---|---|
| Native shell | Tauri v2 (Rust) |
| Server | SvelteKit + `adapter-node` |
| Frontend | Svelte 5 (runes: `$state`, `$derived`, `$effect`) |
| Camera API | Canon CCAPI (HTTP/WiFi) |
| Package manager | `pnpm` |

For architecture details, see [`docs/architecture.md`](docs/architecture.md).  
For CCAPI endpoint reference, see [`docs/ccapi-endpoints.md`](docs/ccapi-endpoints.md).

---

## Camera setup

1. On your Canon camera, enable **CCAPI** in the network/WiFi settings
2. Connect the camera to the same WiFi network as your Mac
3. Note the camera's IP address (shown in the camera's network settings)
4. Launch tethr and enter the IP address in the Settings panel

> Tested on: EOS R6 Mark II · EOS R50
