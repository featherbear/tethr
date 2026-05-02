# AGENTS.md — Router

> This file is a **living system**, not a one-off config. Keep it short and pointer-only.
> Every byte has a cost — load only what you need. Details live in `docs/`. Aim for <200 lines.

---

## Role

AI assistant for a **Tauri v2 + SvelteKit (Svelte 5)** desktop app that previews photos from a Canon EOS R6 Mark II over WiFi (Canon CCAPI).

---

## Hard Rules

- **Package manager:** `pnpm` only — never `npm install` or `yarn`
- **Svelte 5 runes:** use `$state()`, `$derived()`, `$effect()`, `$props()` — never Svelte 4 `$:` or `on:event`
- **TypeScript everywhere:** all new files must be `.ts` / `.svelte` with `<script lang="ts">`
- **Verify before claiming done:** run `pnpm check` and/or `pnpm build` and read the output — never assume success
- **No hallucination:** if unsure about a file or API shape, read it first
- **Probe before implementing:** for any external API (especially CCAPI), `curl` the real endpoint and inspect the raw response before writing a single line of code

---

## Code Style

- Early returns and small helpers · avoid wide diffs · isolate changes per feature
- `camelCase` vars/functions · `PascalCase` types/components
- Import order: (1) framework/svelte (2) `$lib/...` (3) `import type ...`
- Comments only when the *why* is non-obvious

---

## Session Workflow (4 mechanisms)

1. **Start of session** → read `today.md` to resume from last checkpoint
2. **Hit a bug** → search `patterns.md` before debugging
3. **Fixed something** → write the lesson to `patterns.md` immediately
4. **End of session** → update `today.md` with progress and next steps
5. **No "fixed" without proof** → run tests / lint / build, read the output, confirm success — "should be fine" is forbidden

---

## On-Demand Docs (read when relevant)

| When you need… | Read… |
|---|---|
| Project architecture, CCAPI endpoints, Tauri event flow | `docs/architecture.md` |
| Recurring mistakes and their fixes | `patterns.md` |
| Current session state and next steps | `today.md` |

---

## Dev Commands

```
pnpm dev            # start dev server (Vite, port 1420)
pnpm dev:mock       # start dev server + mock CCAPI camera (auto-fires shots)
pnpm mock           # mock CCAPI server only (port 8080)
pnpm check          # type-check (svelte-check)
pnpm build          # production build (adapter-node → build/)
pnpm tauri dev      # open Tauri window (runs pnpm dev automatically)
pnpm tauri build    # bundle macOS .app
```

---

## Git Conventions

- Commit after every meaningful unit of work — do not batch unrelated changes
- Format: `<scope>: <short description>` · scopes: `feat`, `fix`, `chore`, `refactor`, `style`, `docs`
- Never commit without running `pnpm check` first · branch: `main` (solo project)
