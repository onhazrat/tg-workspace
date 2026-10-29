/**
 * The Account's Tags through `useTags`, against a fake server.
 *
 * Watched to fail:
 * - send one request for every handle -> the batches case
 */
import { afterEach, expect, test } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, renderHook } from "@testing-library/react"
import type { ReactNode } from "react"

import { client } from "@/client/client.gen"
import { useTags } from "@/hooks/useTags"

const realConfig = client.getConfig()

type Call = { method: string; path: string; body: unknown }

/** Answer every request with `answer`, recording what was sent. */
function serve(answer: (call: Call) => Response): Call[] {
  const calls: Call[] = []
  client.setConfig({
    baseUrl: "http://localhost",
    fetch: (async (request: Request) => {
      const text = await request.text()
      const call = {
        method: request.method,
        path: new URL(request.url).pathname,
        body: text ? JSON.parse(text) : null,
      }
      calls.push(call)
      return answer(call)
    }) as unknown as typeof fetch,
  })
  return calls
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(() => useTags(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    ),
  }).result
}

afterEach(() => {
  cleanup()
  client.setConfig({ fetch: realConfig.fetch, baseUrl: realConfig.baseUrl })
})

test("a Tag past the server's cap is sent in batches of at most 10,000", async () => {
  const calls = serve((call) =>
    call.path.endsWith("/tags/channels") ? json({ changed: 1 }) : json([]),
  )
  const tags = mount()
  const handles = Array.from({ length: 25_000 }, (_, i) => `h${i}`)

  await tags.current.tag("big", handles)
  await tags.current.untag("big", handles)

  const sent = (method: string) =>
    calls
      .filter((c) => c.method === method && c.path.endsWith("/tags/channels"))
      .map((c) => (c.body as { name: string; handles: string[] }).handles)
  for (const method of ["POST", "DELETE"]) {
    const batches = sent(method)
    expect(batches.map((b) => b.length)).toEqual([10_000, 10_000, 5_000])
    expect(batches.flat()).toEqual(handles)
  }
})
