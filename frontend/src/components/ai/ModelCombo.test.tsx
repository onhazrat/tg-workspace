/**
 * What the model picker may and may not do to a value somebody typed (BYOK-02).
 *
 * The rule this pins is a reversal. `ModelCombo` used to *silently overwrite* a
 * stored model id the provider's catalogue did not list, once per catalogue.
 * That was written for one real case — a deployment-default Gemini id against
 * an account whose only Key is OpenRouter — and it paid for it by destroying
 * every deliberately typed id, including the ones a provider serves without
 * advertising. The overwrite is gone; a warning took its place.
 *
 * The third test is the regression guard for that deletion, and the second is
 * the condition the warning is worthless without: a provider serving no
 * `/models` route answers `[]`, which makes *every* id unlisted, so warning on
 * an empty catalogue would paint a permanent alarm on a correct model for
 * exactly the Ollama and vLLM users the free-text path exists for.
 */
import { afterEach, describe, expect, it } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import type { ReactNode } from "react"

import { ModelCombo } from "@/components/ai/ModelCombo"
import { queryKeys } from "@/hooks/queryKeys"
import {
  forgetModelsForMissingKeys,
  modelForKey,
} from "@/lib/aiKeys/modelMemory"
import { rememberAiKeyId } from "@/lib/aiKeys/selection"

const KEY_ID = "k1"

afterEach(() => {
  cleanup()
  rememberAiKeyId(null)
  forgetModelsForMissingKeys([])
})

/** A client whose model list is already fresh, so no `queryFn` ever runs. */
function mount(
  value: string,
  models: { id: string; label: string }[],
  onChange: (next: string) => void = () => {},
) {
  rememberAiKeyId(KEY_ID)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(queryKeys.aiModels(KEY_ID), {
    models,
    default: models[0]?.id ?? "",
  })
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
  const utils = render(
    <ModelCombo ariaLabel="Model" value={value} onChange={onChange} />,
    { wrapper },
  )
  return { ...utils, qc }
}

const catalogue = [
  { id: "gemini-3-flash", label: "gemini-3-flash" },
  { id: "gpt-5", label: "gpt-5" },
]

describe("ModelCombo", () => {
  it("warns when the catalogue is non-empty and does not list the value", () => {
    mount("something-else", catalogue)
    expect(screen.getByTestId("model-unlisted-warning")).toBeTruthy()
  })

  it("does not warn when the value is in the catalogue", () => {
    mount("gpt-5", catalogue)
    expect(screen.queryByTestId("model-unlisted-warning")).toBeNull()
  })

  it("does not warn when the provider serves no catalogue", () => {
    // `[]` means "this provider cannot be asked", which is evidence of nothing
    // — an Ollama or vLLM endpoint has no `/models` route and every id it
    // happily serves would otherwise be flagged for ever.
    mount("llama3.2:latest", [])
    expect(screen.queryByTestId("model-unlisted-warning")).toBeNull()
  })

  it("never rewrites a typed value when a catalogue arrives", async () => {
    const seen: string[] = []
    // Seeded empty first — a provider whose catalogue has not arrived — so the
    // query never fetches, then the catalogue lands under it.
    const { qc } = mount("my-private-model", [], (next) => seen.push(next))
    act(() => {
      qc.setQueryData(queryKeys.aiModels(KEY_ID), {
        models: catalogue,
        default: "gemini-3-flash",
      })
    })
    await screen.findByTestId("model-unlisted-warning")
    expect(seen).toEqual([])
  })

  it("stays live with no key when the model runs on the Operator Key", () => {
    // Translation is corpus-wide work the deployment pays for (ADR-016), so an
    // Admin holding no personal Key still names its model — and the catalogue
    // on screen belongs to a Key that will not run it, which is why the
    // warning is suppressed too.
    rememberAiKeyId(null)
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <ModelCombo
        ariaLabel="Translation model"
        value="anything-at-all"
        onChange={() => {}}
        operatorKey
      />,
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={qc}>{children}</QueryClientProvider>
        ),
      },
    )
    const trigger = screen.getByLabelText(
      "Translation model",
    ) as HTMLButtonElement
    expect(trigger.disabled).toBe(false)
    expect(screen.queryByTestId("model-unlisted-warning")).toBeNull()
  })

  it("does not commit the filter text when the popover closes", async () => {
    // The box is a filter, not the value. Narrowing the list and then clicking
    // away must leave the model alone — committing here would silently rewrite
    // a working id to whatever prefix was half-typed.
    const seen: string[] = []
    mount("gemini-3-flash", catalogue, (next) => seen.push(next))
    fireEvent.click(screen.getByLabelText("Model"))
    const box = await screen.findByPlaceholderText(/Filter or type a model id/i)
    fireEvent.change(box, { target: { value: "gpt" } })
    fireEvent.keyDown(document.body, { key: "Escape" })
    await waitFor(() =>
      expect(screen.queryByPlaceholderText(/Filter or type/i)).toBeNull(),
    )
    expect(seen).toEqual([])
  })

  it("commits the typed id from the Use row", async () => {
    const seen: string[] = []
    mount("gemini-3-flash", catalogue, (next) => seen.push(next))
    fireEvent.click(screen.getByLabelText("Model"))
    const box = await screen.findByPlaceholderText(/Filter or type a model id/i)
    fireEvent.change(box, { target: { value: "my-private-model" } })
    fireEvent.click(await screen.findByText(/Use "my-private-model"/))
    expect(seen).toEqual(["my-private-model"])
  })

  it("offers no catalogue for a model the Operator Key runs", () => {
    // The models on offer belong to the Account's Key, which is not the Key
    // that will run this one.
    mount("anything", catalogue)
    cleanup()
    rememberAiKeyId(KEY_ID)
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    qc.setQueryData(queryKeys.aiModels(KEY_ID), {
      models: catalogue,
      default: "gpt-5",
    })
    render(
      <ModelCombo
        ariaLabel="Translation model"
        value="deployment-model"
        onChange={() => {}}
        operatorKey
      />,
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={qc}>{children}</QueryClientProvider>
        ),
      },
    )
    fireEvent.click(screen.getByLabelText("Translation model"))
    expect(screen.queryByText("gpt-5")).toBeNull()
  })

  it("records the chosen model against the key that pays for it", async () => {
    mount("gemini-3-flash", catalogue)
    fireEvent.click(screen.getByLabelText("Model"))
    fireEvent.click(await screen.findByText("gpt-5"))
    expect(modelForKey(KEY_ID)).toBe("gpt-5")
  })

  it("records a typed id too, not only a listed one", async () => {
    mount("gemini-3-flash", catalogue)
    fireEvent.click(screen.getByLabelText("Model"))
    fireEvent.change(
      await screen.findByPlaceholderText(/Filter or type a model id/i),
      { target: { value: "my-private-model" } },
    )
    fireEvent.click(await screen.findByText(/Use "my-private-model"/))
    expect(modelForKey(KEY_ID)).toBe("my-private-model")
  })

  it("records nothing for a model the Operator Key runs", async () => {
    // Same reason it shows no catalogue: the model it names is not the Account
    // Key's business, so stamping it onto that Key would make switching Keys
    // drag the deployment's translation model into an Artifact run.
    rememberAiKeyId(KEY_ID)
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <ModelCombo
        ariaLabel="Translation model"
        value="deployment-model"
        onChange={() => {}}
        operatorKey
      />,
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={qc}>{children}</QueryClientProvider>
        ),
      },
    )
    fireEvent.click(screen.getByLabelText("Translation model"))
    fireEvent.change(
      await screen.findByPlaceholderText(/Filter or type a model id/i),
      { target: { value: "some-operator-model" } },
    )
    fireEvent.click(await screen.findByText(/Use "some-operator-model"/))
    expect(modelForKey(KEY_ID)).toBeNull()
  })

  it("is disabled with no key selected", () => {
    rememberAiKeyId(null)
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(<ModelCombo ariaLabel="Model" value="gpt-5" onChange={() => {}} />, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      ),
    })
    const trigger = screen.getByLabelText("Model") as HTMLButtonElement
    expect(trigger.disabled).toBe(true)
    expect(trigger.textContent).toContain("Add a key first")
  })
})
