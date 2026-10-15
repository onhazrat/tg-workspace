/**
 * The retry's Key and Model chips and the prompt-size warning (SFR-04). What is
 * pinned: the Model chip lists the chosen Key's own catalogue; switching Key
 * restores the model last run on it; neither choice touches the Account's
 * selected Key or a Key's remembered model; and the warning's three states.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"

import type { SummaryAttemptResponse } from "@/client"
import { queryKeys } from "@/hooks/queryKeys"
import {
  forgetModelsForMissingKeys,
  modelForKey,
} from "@/lib/aiKeys/modelMemory"
import { rememberAiKeyId, selectedAiKeyId } from "@/lib/aiKeys/selection"
import { type RetryChoice, RetryRunWith } from "./RetryRunWith"

afterEach(() => {
  cleanup()
  rememberAiKeyId(null)
  forgetModelsForMissingKeys([])
})

const key = (id: string, label: string) => ({
  id,
  label,
  provider: "gemini",
  baseUrl: null,
  lastValidated: null,
})

const attempt = (keyId: string, model: string) =>
  ({ keyId, model }) as SummaryAttemptResponse

function mount(
  value: RetryChoice,
  { prompt = "x".repeat(4000) as string | null } = {},
) {
  rememberAiKeyId("k1")
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(queryKeys.aiKeys, [
    key("k1", "Work key"),
    key("k2", "Spare key"),
  ])
  qc.setQueryData(queryKeys.aiModels("k1"), {
    models: [{ id: "small", label: "small", contextLength: 1000 }],
    default: "small",
  })
  qc.setQueryData(queryKeys.aiModels("k2"), {
    models: [
      { id: "tight", label: "tight", contextLength: 1200 },
      { id: "roomy", label: "roomy", contextLength: 100_000 },
      { id: "mystery", label: "mystery", contextLength: null },
    ],
    default: "roomy",
  })
  const onChange = mock()
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
  render(
    <RetryRunWith
      value={value}
      onChange={onChange}
      attempts={[attempt("k2", "roomy"), attempt("k1", "small")]}
      promptText={prompt ?? undefined}
    />,
    { wrapper },
  )
  return { onChange }
}

describe("RetryRunWith", () => {
  test("switching Key restores the model last run on it and leaves the defaults", () => {
    const { onChange } = mount({ keyId: "k1", model: "small" })

    fireEvent.change(screen.getByLabelText("Retry AI key"), {
      target: { value: "k2" },
    })

    expect(onChange).toHaveBeenCalledWith({ keyId: "k2", model: "roomy" })
    expect(selectedAiKeyId()).toBe("k1")
  })

  test("the Model chip lists the chosen Key's models, and a pick is not remembered", () => {
    const { onChange } = mount({ keyId: "k2", model: "roomy" })

    fireEvent.click(screen.getByRole("combobox", { name: "Retry model" }))
    expect(screen.getByRole("option", { name: "mystery" })).toBeTruthy()
    expect(screen.queryByRole("option", { name: "small" })).toBeNull()
    fireEvent.click(screen.getByRole("option", { name: "mystery" }))

    expect(onChange).toHaveBeenCalledWith({ keyId: "k2", model: "mystery" })
    expect(modelForKey("k2")).toBeNull()
  })

  test("a prompt past the window won't fit", () => {
    mount({ keyId: "k1", model: "small" }, { prompt: "x".repeat(4004 + 4) })
    expect(screen.getByTestId("prompt-fit").textContent).toContain("won't fit")
  })

  test("a prompt past 80% of the window is tight", () => {
    mount({ keyId: "k2", model: "tight" })
    expect(screen.getByTestId("prompt-fit").textContent).toContain("tight")
  })

  test("room to spare, an unknown window or no prompt shows nothing", () => {
    mount({ keyId: "k2", model: "roomy" })
    expect(screen.queryByTestId("prompt-fit")).toBeNull()
    cleanup()
    mount({ keyId: "k2", model: "mystery" })
    expect(screen.queryByTestId("prompt-fit")).toBeNull()
    cleanup()
    mount({ keyId: "k1", model: "small" }, { prompt: null })
    expect(screen.queryByTestId("prompt-fit")).toBeNull()
  })
})
