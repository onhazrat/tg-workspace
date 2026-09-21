/**
 * Asking which Key is selected has to be enough to find out.
 *
 * The selection is written by `reconcileAiKeySelection` inside the Key list's
 * `queryFn`, so a screen that never fetches that list reads whatever storage
 * already held — `null` in a fresh browser. Three of the four `ModelCombo` call
 * sites are such screens (Chat, and both Settings → AI pickers, which sit on a
 * different sub-tab from AI Keys), and they render *disabled* on a `null`. An
 * Account holding several Keys therefore found the model picker dead on arrival
 * telling it to add one.
 *
 * So the hook mounts the query. This pins that, not the wiring: what is
 * asserted is that a component which asks only for the selection ends up with
 * one, having fetched nothing itself.
 */
import { afterEach, describe, expect, it } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"

import { client } from "@/client/client.gen"
import { useSelectedAiKeyId } from "@/hooks/useAiKeys"
import { rememberAiKeyId } from "@/lib/aiKeys/selection"

const realConfig = client.getConfig()

afterEach(() => {
  cleanup()
  rememberAiKeyId(null)
  client.setConfig({ fetch: realConfig.fetch, baseUrl: realConfig.baseUrl })
})

describe("useSelectedAiKeyId", () => {
  it("resolves a selection on a screen that fetched nothing itself", async () => {
    client.setConfig({
      baseUrl: "http://localhost",
      fetch: (async () =>
        new Response(
          JSON.stringify([
            {
              id: "k1",
              label: "One",
              provider: "gemini",
              baseUrl: null,
              hasKey: true,
              lastValidated: null,
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        )) as unknown as typeof fetch,
    })
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const { result } = renderHook(() => useSelectedAiKeyId(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      ),
    })
    expect(result.current).toBeNull()
    await waitFor(() => expect(result.current).toBe("k1"))
  })
})
