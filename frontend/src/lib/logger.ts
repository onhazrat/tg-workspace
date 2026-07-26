/**
 * Console logging that does not follow the app into staging and production.
 *
 * The IndexedDB layer and the sync queue narrate themselves with `console.log`
 * — `[DB] Initializing database...`, `[DB] Deleted 1 posts older than 90 days.`
 * Those lines were showing up in the console of a built, minified bundle, which
 * is noise for an operator and tells a visitor more about internals than it
 * should.
 *
 * `debug` is for that narration and is silent outside dev. `warn` and `error`
 * are unconditional: they report real problems, and an operator reading a
 * staging console needs them.
 *
 * Vite replaces `import.meta.env.DEV` with a literal at build time, so the
 * branch folds away rather than being evaluated per call.
 */

/**
 * True only under `vite dev`.
 *
 * Referenced as a direct member access rather than through a destructured or
 * guarded `import.meta.env`, because that is the form Vite replaces with a
 * literal — which lets the bundler drop the call below entirely instead of
 * emitting a runtime lookup. Under bun (unit tests) the key is absent, so this
 * reads false, matching a production build.
 */
const isDev = Boolean(import.meta.env.DEV)

export const logger = {
  /** Development-only narration. Stripped from staging and production output. */
  debug: (...args: unknown[]): void => {
    if (isDev) console.debug(...args)
  },
  /** Recoverable problems worth surfacing wherever the app runs. */
  warn: (...args: unknown[]): void => {
    console.warn(...args)
  },
  /** Failures. Always reported. */
  error: (...args: unknown[]): void => {
    console.error(...args)
  },
}
