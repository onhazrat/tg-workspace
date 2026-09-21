/**
 * The AI Key chip is always here, and at zero Keys it is the way out (BYOK-01).
 *
 * The bar used to render the chip only above two Keys, on the argument that
 * with fewer there was nothing to choose between. That is true about choosing
 * and false about everything else: an account with no Key gets
 * `AI_KEY_MISSING_DETAIL` from the run button directly below this bar, and the
 * only cure lived two tabs away in Settings, unmentioned by the error.
 *
 * So what is pinned is the shape of each state rather than the markup: nothing
 * to select means an add control *instead of* a select, and holding Keys means
 * a select with a small add control beside it.
 */
import { afterEach, describe, expect, it } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"

import { RunSettingsBar } from "@/components/action/RunSettingsBar"
import { ThemeProvider } from "@/components/theme-provider"
import { SettingsProvider } from "@/contexts/SettingsContext"
import { queryKeys } from "@/hooks/queryKeys"
import { rememberAiKeyId } from "@/lib/aiKeys/selection"
import type { AiKey } from "@/lib/aiKeys/store"

afterEach(() => {
  cleanup()
  rememberAiKeyId(null)
})

function key(id: string, label: string): AiKey {
  return {
    id,
    label,
    provider: "gemini",
    baseUrl: null,
    hasKey: true,
    lastValidated: null,
  } as unknown as AiKey
}

function mount(keys: AiKey[]) {
  if (keys[0]) rememberAiKeyId(keys[0].id)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(queryKeys.aiKeys, keys)
  qc.setQueryData(queryKeys.aiModels(keys[0]?.id ?? null), {
    models: [],
    default: "",
  })
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <SettingsProvider>{children}</SettingsProvider>
        </ThemeProvider>
      </QueryClientProvider>
    )
  }
  return render(<RunSettingsBar />, { wrapper })
}

describe("RunSettingsBar", () => {
  it("offers an add control instead of a select when there are no keys", () => {
    mount([])
    expect(screen.queryByLabelText("AI key")).toBeNull()
    const add = screen.getByLabelText("Add AI key")
    // Labelled rather than a bare icon: with nothing to select this *is* the
    // control, and it carries the same sentence the settings panel shows.
    expect(add.textContent).toContain("Add AI key")
    expect(
      screen.getByText("No AI keys saved yet. Add one to create summaries."),
    ).toBeTruthy()
  })

  it("renders the select for a single key, with the add control beside it", () => {
    mount([key("k1", "Work key")])
    const select = screen.getByLabelText("AI key") as HTMLSelectElement
    expect(select.value).toBe("k1")
    expect(screen.getByText("Work key")).toBeTruthy()
    expect(screen.getByLabelText("Add AI key")).toBeTruthy()
  })

  it("lists every key when there are several", () => {
    mount([key("k1", "Cheap key"), key("k2", "Expensive key")])
    const select = screen.getByLabelText("AI key") as HTMLSelectElement
    expect(select.options.length).toBe(2)
    expect(select.value).toBe("k1")
  })
})
