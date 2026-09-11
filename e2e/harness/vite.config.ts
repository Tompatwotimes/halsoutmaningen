import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Standalone Vite app that mounts the REAL ChatPanel with a fixture-driven
// mock of useChat, so a real browser (Playwright) can exercise the actual
// Sheet portal / CSS / scroll container / ResizeObserver lifecycle.
export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^@\/features\/chat\/useChat$/,
        replacement: fileURLToPath(
          new URL('./mock-useChat.tsx', import.meta.url),
        ),
      },
      {
        find: /^\.\/useChat$/,
        replacement: fileURLToPath(
          new URL('./mock-useChat.tsx', import.meta.url),
        ),
      },
      {
        find: '@',
        replacement: fileURLToPath(new URL('../../src', import.meta.url)),
      },
    ],
  },
  server: { port: 5199, host: '127.0.0.1' },
});
