/**
 * The Directory's small Condition editors (DIR-02): Name contains takes any
 * text, and Cited by your channels takes all time or a window in days.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { DirectoryCond } from "@/lib/directory/directory-filter"
import {
  HandlesEditor,
  MineEditor,
  NameEditor,
} from "./DirectoryConditionEditors"

afterEach(cleanup)

const submit = () => screen.getByRole("button", { name: /^(Add|Update)/ })

describe("Name contains", () => {
  test("adds the trimmed text, and refuses none", () => {
    const got: DirectoryCond[] = []
    render(<NameEditor onSubmit={(c) => got.push(c)} />)
    expect((submit() as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "  news " },
    })
    fireEvent.click(submit())
    expect(got).toEqual([{ type: "name", value: "news" }])
  })

  test("opens on the Condition it edits", () => {
    render(
      <NameEditor start={{ type: "name", value: "fa" }} onSubmit={() => {}} />,
    )
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("fa")
    expect(submit().textContent).toBe("Update")
  })
})

describe("Cited by @x and Cites @x", () => {
  test("adds the typed handles, and refuses none", () => {
    const got: DirectoryCond[] = []
    render(<HandlesEditor type="cites" onSubmit={(c) => got.push(c)} />)
    expect((submit() as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "@Alpha, beta  alpha" },
    })
    fireEvent.click(submit())
    expect(got).toEqual([{ type: "cites", handles: ["alpha", "beta"] }])
  })

  test("opens on the handles it edits", () => {
    render(
      <HandlesEditor
        type="citedby"
        start={{ type: "citedby", handles: ["a", "b"] }}
        onSubmit={() => {}}
      />,
    )
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("a b")
    expect(screen.getByText("Cited by")).toBeTruthy()
  })
})

describe("Cited by your channels", () => {
  test("all time is no window", () => {
    const got: DirectoryCond[] = []
    render(<MineEditor onSubmit={(c) => got.push(c)} />)
    fireEvent.click(screen.getByRole("button", { name: "any time" }))
    fireEvent.click(submit())
    expect(got).toEqual([{ type: "mine" }])
  })

  test("a preset or any number of days is a window", () => {
    const got: DirectoryCond[] = []
    render(<MineEditor onSubmit={(c) => got.push(c)} />)
    fireEvent.click(screen.getByRole("button", { name: "30d" }))
    fireEvent.click(submit())
    fireEvent.change(screen.getByRole("spinbutton", { name: "Days" }), {
      target: { value: "45" },
    })
    fireEvent.click(submit())
    expect(got).toEqual([
      { type: "mine", days: 30 },
      { type: "mine", days: 45 },
    ])
  })

  test("opens on the window it edits", () => {
    render(<MineEditor start={{ type: "mine", days: 7 }} onSubmit={() => {}} />)
    expect(
      (screen.getByRole("spinbutton", { name: "Days" }) as HTMLInputElement)
        .value,
    ).toBe("7")
  })
})
