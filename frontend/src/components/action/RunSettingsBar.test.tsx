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
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import type { ReactNode } from "react"

import { RunSettingsBar } from "@/components/action/RunSettingsBar"
import { ThemeProvider } from "@/components/theme-provider"
import { SettingsProvider } from "@/contexts/SettingsContext"
import { queryKeys } from "@/hooks/queryKeys"
import {
  forgetModelsForMissingKeys,
  rememberModelForKey,
} from "@/lib/aiKeys/modelMemory"
import { rememberAiKeyId } from "@/lib/aiKeys/selection"
import type { AiKey } from "@/lib/aiKeys/store"

afterEach(() => {
  cleanup()
  rememberAiKeyId(null)
  forgetModelsForMissingKeys([])
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
  it("orders the chips key, model, language", () => {
    // The order the choices depend on each other in: the Key decides which
    // catalogue the model picker offers and which model the bar restores.
    mount([key("k1", "One")])
    const bar = screen.getByTestId("action-run-settings")
    const labels = [...bar.querySelectorAll("[aria-label]")]
      .map((el) => el.getAttribute("aria-label"))
      .filter((l): l is string =>
        ["AI key", "Add AI key", "Inference model", "Output language"].includes(
          l ?? "",
        ),
      )
    expect(labels).toEqual([
      "AI key",
      "Add AI key",
      "Inference model",
      "Output language",
    ])
  })

  it("switches to the model last run on the newly selected key", async () => {
    // One setting, but a Key reaches one provider's catalogue — so switching
    // Keys used to leave the previous provider's id in the box.
    rememberModelForKey("k2", "anthropic/claude-sonnet-5")
    mount([key("k1", "Gemini key"), key("k2", "Router key")])
    const select = screen.getByLabelText("AI key") as HTMLSelectElement
    fireEvent.change(select, { target: { value: "k2" } })
    await waitFor(() =>
      expect(screen.getByLabelText("Inference model").textContent).toContain(
        "anthropic/claude-sonnet-5",
      ),
    )
  })

  it("leaves the model alone for a key with nothing recorded", async () => {
    mount([key("k1", "One"), key("k2", "Two")])
    const before = screen.getByLabelText("Inference model").textContent
    fireEvent.change(screen.getByLabelText("AI key"), {
      target: { value: "k2" },
    })
    await waitFor(() => expect(screen.getByLabelText("AI key")).toBeTruthy())
    expect(screen.getByLabelText("Inference model").textContent).toBe(before)
  })

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
