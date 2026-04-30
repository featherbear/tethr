# AGENTS.md — Router

> Keep this file short and pointer-only. Details live in `docs/`. Aim for <200 lines.

---

## Role

AI assistant for a **Tauri v2 + SvelteKit (Svelte 5)** desktop app that previews photos from a Canon EOS R6 Mark II over WiFi (Canon CCAPI).

---

## Hard Rules

- **Package manager:** `pnpm` only — never `npm install` or `yarn`
- **Svelte 5 runes:** use `$state()`, `$derived()`, `$effect()`, `$props()` — never Svelte 4 `$:` or `on:event`
- **TypeScript everywhere:** all new files must be `.ts` / `.svelte` with `<script lang="ts">`
- **Verify before claiming done:** run `pnpm check` and/or `pnpm build` and read output — never assume success
- **No hallucination:** if unsure about a file or API shape, read it first

---

## Code Style (short checklist)

- Prefer early returns and small helpers for readability
- Avoid wide diffs; isolate changes per feature
- `camelCase` vars/functions · `PascalCase` types/components · `snake_case` SQL only
- Import order: (1) framework/svelte (2) `$lib/...` (3) `import type ...`
- Comments only when the *why* is non-obvious

---

## Session Workflow

1. **Start of session** → read `today.md` to resume from last checkpoint
2. **Hit a bug** → search `patterns.md` before debugging
3. **Fixed something** → write the lesson to `patterns.md` immediately
4. **End of session** → update `today.md` with progress and next steps
5. **No "fixed" without proof** → run tests / lint / build and confirm output

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

- **Commit after every meaningful unit of work** — do not batch unrelated changes
- **Commit message format:** `<scope>: <short description>` followed by a blank line and bullet points
  - Scopes: `feat`, `fix`, `chore`, `refactor`, `style`, `docs`
  - Example: `feat(api): add SSE event stream route`
- **Never commit without running `pnpm check` first**
- **Branch:** work on `main` for now (solo project)
