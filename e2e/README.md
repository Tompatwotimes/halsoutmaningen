# Real-browser e2e — Shared Chat open/scroll

Why: the jsdom component tests missed the production "chat opens above the
latest message" bug **twice**. jsdom does not clamp `scrollTop`, has no layout
engine, and no real `ResizeObserver` timing. This suite mounts the **real**
`ChatPanel` (real `Sheet` portal, real CSS, real scroll container, real RO) via
a fixture-driven harness and drives it with Chromium.

## Run

```bash
npm run test:e2e
```

Needs a Chromium binary: `npx playwright install chromium`.

In a sandboxed/CI Linux box without system GUI libs, install the headless-shell
lib set once and export `LD_LIBRARY_PATH` to a prefix holding:
`libatk-1.0`, `libatk-bridge-2.0`, `libatspi`, `libXcomposite`, `libXdamage`,
`libXfixes`, `libXrandr`, `libgbm`, `libasound`, `libXrender`, `libXi`,
`libXtst`, `libXss` (`apt-get download …` + `dpkg -x` works without root), and
set `PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1`.

## Not in the standard CI

The `Database Tests` workflow and `npm run test` (Vitest) stay the required
gates. This browser suite is a **local** gate — CI here has no browser binary.

## Layout

- `harness/` — a standalone Vite app: real `ChatPanel` + a fixture mock of
  `useChat` (`window.__chat` control surface).
- `playwright.config.ts` — mobile-Chromium project, starts the harness server.
- `chat-open-scroll.spec.ts` — the P0 regression matrix.
