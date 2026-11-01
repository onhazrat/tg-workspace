/**
 * Test preload: give `bun test` a DOM.
 *
 * Until now the only way to test a component here was `renderToStaticMarkup`
 * (`react-dom/server`) — one static pass, no effects, no state updates, no
 * interaction. That is why 0 of 9 contexts and 2 of 32 hooks had tests: the
 * capability did not exist, rather than having been skipped.
 *
 * Registering happy-dom globally makes `@testing-library/react`'s `render` and
 * `renderHook` work, which is what the context/hook refactors in
 * `docs/architecture-simplification-plan.md` (A3, G1, G2) need as a safety net.
 *
 * The existing `renderToStaticMarkup` tests keep working unchanged — a DOM
 * being present does not change what SSR produces.
 */
import { afterEach } from "bun:test"
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { client } from "@/client/client.gen"

GlobalRegistrator.register()
// Loaded after the DOM exists: a static import is hoisted above `register()`,
// and Testing Library then binds to no document.
const { cleanup } = await import("@testing-library/react")

// The generated client is one object every test file shares. A test that stubs
// its `fetch` and forgets to put it back hands the stub to whichever file runs
// next, so the run order decides what passes. `setConfig` merges, so the keys
// tests change are named to put them back even when they started unset.
//
// Plotly likewise leaves a hidden `#js-plotly-tester` svg in `document.body`
// after its first chart (and makes it again when it next draws), which a test
// snapshotting the body would see only when a chart test ran before it. So
// would the containers of a file that renders without calling `cleanup`.
const clientDefaults = client.getConfig()
afterEach(() => {
  client.setConfig({
    ...clientDefaults,
    baseUrl: clientDefaults.baseUrl,
    fetch: clientDefaults.fetch,
  })
  cleanup()
  document.getElementById("js-plotly-tester")?.remove()
})
