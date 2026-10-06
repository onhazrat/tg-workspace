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
  SharedEditor,
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

describe("Shared parents and Shared children (DIR-07)", () => {
  const sets = {
    picked: ["t1", "t2"],
    selection: ["s1"],
    follows: ["f1", "f2", "f3"],
  }
  const choice = (name: RegExp) =>
    screen.getByRole("radio", { name }) as HTMLInputElement

  test("lists the five picks with their counts, the live ticks chosen first", () => {
    render(<SharedEditor type="parents" sets={sets} onSubmit={() => {}} />)
    expect(screen.getByText("Compared with")).toBeTruthy()
    expect(choice(/ticked in this list \(2\)/).checked).toBe(true)
    expect(choice(/ticked in this list, saved now \(2\)/)).toBeTruthy()
    expect(choice(/Channels tab selection \(1\)/)).toBeTruthy()
    expect(choice(/Every channel you follow \(3\)/)).toBeTruthy()
    expect(choice(/These channels/)).toBeTruthy()
    // The live choice says a tick takes a Channel out of the results.
    expect(screen.getByText(/leaves the results/)).toBeTruthy()
  })

  test("with nothing ticked the two ticked choices are off", () => {
    render(
      <SharedEditor
        type="parents"
        sets={{ ...sets, picked: [] }}
        onSubmit={() => {}}
      />,
    )
    expect(choice(/ticked in this list \(0\)/).disabled).toBe(true)
    expect(choice(/saved now/).disabled).toBe(true)
    expect(choice(/Channels tab selection/).checked).toBe(true)
  })

  test("each choice adds its picks and the minimum", () => {
    const got: DirectoryCond[] = []
    render(
      <SharedEditor
        type="children"
        sets={sets}
        onSubmit={(c) => got.push(c)}
      />,
    )
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Minimum shared" }),
      { target: { value: "3" } },
    )
    fireEvent.click(submit())
    fireEvent.click(choice(/saved now/))
    fireEvent.click(submit())
    fireEvent.click(choice(/Every channel you follow/))
    fireEvent.click(submit())
    fireEvent.click(choice(/These channels/))
    expect((submit() as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByRole("textbox", { name: "Handles" }), {
      target: { value: "@A b" },
    })
    fireEvent.click(submit())
    expect(got).toEqual([
      { type: "children", picks: "picked", handles: [], min: 3 },
      { type: "children", picks: "handles", handles: ["t1", "t2"], min: 3 },
      { type: "children", picks: "follows", handles: [], min: 3 },
      { type: "children", picks: "handles", handles: ["a", "b"], min: 3 },
    ])
  })

  test("a saved choice reopens as These channels, its handles to edit", () => {
    render(
      <SharedEditor
        type="parents"
        sets={sets}
        start={{
          type: "parents",
          picks: "handles",
          handles: ["t1", "t2"],
          min: 4,
        }}
        onSubmit={() => {}}
      />,
    )
    expect(choice(/These channels/).checked).toBe(true)
    expect(
      (screen.getByRole("textbox", { name: "Handles" }) as HTMLInputElement)
        .value,
    ).toBe("t1 t2")
    expect(
      (
        screen.getByRole("spinbutton", {
          name: "Minimum shared",
        }) as HTMLInputElement
      ).value,
    ).toBe("4")
    expect(submit().textContent).toBe("Update")
  })

  test("Shared children says picks nobody follows find little", () => {
    render(<SharedEditor type="children" sets={sets} onSubmit={() => {}} />)
    expect(screen.getByText(/only Channels somebody follows/i)).toBeTruthy()
  })
})
