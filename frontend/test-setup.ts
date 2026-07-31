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
import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register()
