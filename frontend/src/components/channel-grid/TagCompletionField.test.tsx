/**
 * The bulk tag field's ghost completion (CTB-05): what is drawn after the
 * caret, what Tab, → and Enter do with it, and the hint under the field.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import type { TagSuggestion } from "@/lib/channels/bulk-tag-suggestions"
import { TagCompletionField } from "./TagCompletionField"

afterEach(cleanup)

const suggestions: TagSuggestion[] = [
  { tag: "tech", total: 12, inTargets: 3 },
  { tag: "news", total: 5, inTargets: 1 },
  { tag: "technology", total: 2, inTargets: 0 },
]

function mount() {
  const submitted: string[] = []
  function Harness() {
    const [value, setValue] = useState("")
    return (
      <TagCompletionField
        label="Add tag"
        button="Add"
        value={value}
        onChange={setValue}
        onSubmit={() => submitted.push(value)}
        suggestions={suggestions}
        testId="tag"
      />
    )
  }
  render(<Harness />)
  const input = screen.getByTestId("tag-input") as HTMLInputElement
  const type = (text: string) =>
    fireEvent.change(input, { target: { value: text } })
  const ghost = () => screen.queryByTestId("tag-ghost")?.textContent ?? null
  const hint = () => screen.getByTestId("tag-hint").textContent
  return { input, type, ghost, hint, submitted }
}

describe("TagCompletionField", () => {
  test("draws the best completion after the caret, any case, with its counts", () => {
    const { type, ghost, hint } = mount()
    type("TE")
    expect(ghost()).toBe("ch")
    expect(hint()).toBe("tech · on 12 channels, 3 of these")
  })

  test("Tab accepts the completion", () => {
    const { input, type, ghost } = mount()
    type("ne")
    fireEvent.keyDown(input, { key: "Tab" })
    expect(input.value).toBe("news")
    expect(ghost()).toBeNull()
  })

  test("→ accepts it only with the caret at the end", () => {
    const { input, type } = mount()
    type("te")
    input.setSelectionRange(1, 1)
    fireEvent.keyDown(input, { key: "ArrowRight" })
    expect(input.value).toBe("te")
    input.setSelectionRange(2, 2)
    fireEvent.keyDown(input, { key: "ArrowRight" })
    expect(input.value).toBe("tech")
  })

  test("Enter submits what was typed, not the completion", () => {
    const { input, type, submitted } = mount()
    type("te")
    fireEvent.submit(input)
    expect(submitted).toEqual(["te"])
    expect(input.value).toBe("te")
  })

  test("a whole tag shows its counts with nothing to complete", () => {
    const { type, ghost, hint } = mount()
    type("news")
    expect(ghost()).toBeNull()
    expect(hint()).toBe("news · on 5 channels, 1 of these")
  })

  test("says so when no existing tag starts like the text", () => {
    const { type, ghost, hint } = mount()
    type("tex")
    expect(ghost()).toBeNull()
    expect(hint()).toBe("no existing tag starts like this")
    type("")
    expect(hint()).toBe("")
  })
})
