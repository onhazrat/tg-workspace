/**
 * The app version, from `package.json` via Vite `define` (`vite.config.ts`).
 *
 * It was previously hardcoded in two places that disagreed with each other and
 * with `package.json`: `v1.0` in the header and `2.5.0-stable` in Settings, the
 * latter inherited from the standalone pre-migration app. One source now.
 */

/**
 * `__APP_VERSION__` is substituted at build time and so does not exist under a
 * plain runtime such as the unit-test process. Resolved defensively rather than
 * referenced bare, which would throw a ReferenceError.
 */
export const APP_VERSION: string =
  typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0-dev"
