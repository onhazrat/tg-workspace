/**
 * The one copy of the add-key rules (BYOK-01), now that two surfaces render it.
 *
 * Extracting this form is only worth anything if the behaviour survived the
 * move, so what is pinned here is exactly what `AIKeysPanel` used to do alone:
 * the two provider kinds, the base URL that belongs to one of them, the two
 * client-side refusals that never reach the network, and — the case most likely
 * to be "simplified" away — a Key that saved *without* verifying is still
 * saved, still used, and says so.
 *
 * **No `mock.module`.** Bun's module mocks are process-wide (see
 * `DataContext.test.tsx`), so the generated client's own `fetch` is swapped
 * through `client.setConfig` and restored afterwards.
 */
import { afterEach, describe, expect, it } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import type { ReactNode } from "react"
import { client } from "@/client/client.gen"
import { AiKeyAddForm } from "@/components/ai/AiKeyAddForm"

const realConfig = client.getConfig()

afterEach(() => {
  cleanup()
  client.setConfig({ fetch: realConfig.fetch, baseUrl: realConfig.baseUrl })
})

/** Answer every request with one saved-key payload, and record the calls. */
function stubSave(validated: boolean) {
  const calls: string[] = []
  const fetchStub = (async (input: Request | string) => {
    calls.push(typeof input === "string" ? input : input.url)
    return new Response(
      JSON.stringify({
        key: {
          id: "k1",
          label: "My key",
          provider: "gemini",
          baseUrl: null,
          hasKey: true,
          lastValidated: validated ? new Date().toISOString() : null,
        },
        validated,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )
  }) as unknown as typeof fetch
  // happy-dom serves `about:blank`, where a relative URL cannot be made into a
  // `Request` — the client builds one before any fetch is called, so the stub
  // needs an absolute origin to be reached at all.
  client.setConfig({ fetch: fetchStub, baseUrl: "http://localhost" })
  return calls
}

function mount(onSaved?: () => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
  return render(<AiKeyAddForm onSaved={onSaved} />, { wrapper })
}

describe("AiKeyAddForm", () => {
  it("shows the base URL field only for the OpenAI-compatible kind", () => {
    mount()
    expect(screen.queryByPlaceholderText(/BASE URL/i)).toBeNull()
    fireEvent.change(screen.getByLabelText("Provider"), {
      target: { value: "openai_compatible" },
    })
    expect(screen.getByPlaceholderText(/BASE URL/i)).toBeTruthy()
  })

  it("refuses an empty secret without calling the server", async () => {
    const calls = stubSave(true)
    mount()
    fireEvent.click(screen.getByRole("button", { name: /save key/i }))
    await screen.findByText("Paste a provider API key first.")
    expect(calls).toEqual([])
  })

  it("refuses an OpenAI-compatible key with no base URL", async () => {
    const calls = stubSave(true)
    mount()
    fireEvent.change(screen.getByLabelText("Provider"), {
      target: { value: "openai_compatible" },
    })
    fireEvent.change(screen.getByPlaceholderText(/PROVIDER API KEY/i), {
      target: { value: "sk-abc" },
    })
    fireEvent.click(screen.getByRole("button", { name: /save key/i }))
    await screen.findByText("An OpenAI-compatible key needs a base URL.")
    expect(calls).toEqual([])
  })

  it("keeps an unverified key, says so, and does not report success", async () => {
    stubSave(false)
    let saved = 0
    mount(() => {
      saved += 1
    })
    fireEvent.change(screen.getByPlaceholderText(/PROVIDER API KEY/i), {
      target: { value: "sk-abc" },
    })
    fireEvent.click(screen.getByRole("button", { name: /save key/i }))
    await screen.findByText(/could not verify it with the provider/i)
    // The caller closes a dialog on `onSaved`, which would throw the message
    // above away — the one state where there is something to read.
    expect(saved).toBe(0)
  })

  it("reports success when the provider verified the key", async () => {
    stubSave(true)
    let saved = 0
    mount(() => {
      saved += 1
    })
    fireEvent.change(screen.getByPlaceholderText(/PROVIDER API KEY/i), {
      target: { value: "sk-abc" },
    })
    fireEvent.click(screen.getByRole("button", { name: /save key/i }))
    await waitFor(() => expect(saved).toBe(1))
    expect(screen.queryByText(/could not verify/i)).toBeNull()
  })
})
