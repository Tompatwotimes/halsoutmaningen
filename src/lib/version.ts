/**
 * Single canonical app version source — package.json's `version`, injected at
 * build time via vite.config.ts's `define`. Never hardcode a version string
 * anywhere else.
 */
export const APP_VERSION = __APP_VERSION__;
