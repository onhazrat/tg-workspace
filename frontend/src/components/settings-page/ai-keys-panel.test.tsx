/** The AI keys table (SET-03), props only. */
import { afterEach, describe, expect, mock, test } from "bun:test"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import type { AiKey } from "@/lib/aiKeys/store"
import { AiKeysTable } from "./ai-keys-panel"

afterEach(cleanup)

const key = (over: Partial<AiKey>): AiKey =>
  ({
    id: "k1",
    label: "Work key",
    provider: "gemini",
    baseUrl: null,
    hasKey: true,
    lastValidated: null,
    ...over,
  }) as AiKey

describe("AiKeysTable", () => {
  test("no keys says Summaries need one", () => {
    render(<AiKeysTable keys={[]} onDelete={async () => {}} />)
    expect(screen.getByText(/Summaries need one/)).toBeTruthy()
  })

  test("shows the provider or base URL and whether the key was verified", () => {
    render(
      <AiKeysTable
        keys={[
          key({}),
          key({
            id: "k2",
            label: "Router",
            provider: "openai_compatible",
            baseUrl: "https://openrouter.ai/api/v1",
            lastValidated: Date.now(),
          }),
        ]}
        onDelete={async () => {}}
      />,
    )
    const work = screen.getByRole("row", { name: /Work key/ })
    expect(work.textContent).toContain("gemini")
    expect(work.textContent).toContain("Not verified, still used")
    const router = screen.getByRole("row", { name: /Router/ })
    expect(router.textContent).toContain("https://openrouter.ai/api/v1")
    expect(router.textContent).toContain("Verified")
  })

  test("deleting a key asks first", async () => {
    const onDelete = mock(async (_id: string) => {})
    render(<AiKeysTable keys={[key({})]} onDelete={onDelete} />)
    fireEvent.click(screen.getByRole("button", { name: "Delete Work key" }))
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("k1"))
  })
})
