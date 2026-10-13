/**
 * The Directory's small Condition editors (DIR-02): Name contains takes any
 * text, and Cited by your channels takes all time or a window in days.
 * DIR-07's Shared editor was watched to fail on offering the saved ticked
 * choice with nothing ticked; the table's Shared column on showing while its
 * Condition is off (`DirectoryTable.test.tsx`). DFP-05's were watched to fail
 * on a fill that copied the wrong set, on a 501st handle still submitting, on
 * the Tag choice sending handles, and on the Tag choice offered with no Tags.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { DirectoryCond } from "@/lib/directory/directory-filter"
import type { TagChoices } from "@/lib/directory/directory-tags"
import {
  HandlesEditor,
  MineEditor,
  NameEditor,
  SharedEditor,
} from "./DirectoryConditionEditors"

afterEach(cleanup)

const sets = {
  ticked: ["t1", "t2"],
  selection: ["s1"],
  follows: ["f1", "f2", "f3"],
}
const tags: TagChoices = {
  tags: [{ name: "News", channels: 4 }],
  groups: ["Morning"],
  loaded: true,
}
const noTags: TagChoices = { tags: [], groups: [], loaded: true }
const choice = (name: RegExp) =>
  screen.getByRole("radio", { name }) as HTMLInputElement
const tagPicker = () =>
  screen.getByRole("combobox", { name: "Tag" }) as HTMLSelectElement

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
  const handlesBox = () =>
    screen.getByRole("textbox", { name: "Handles" }) as HTMLInputElement

  test("adds the typed handles, and refuses none", () => {
    const got: DirectoryCond[] = []
    render(
      <HandlesEditor
        type="cites"
        sets={sets}
        tags={tags}
        onSubmit={(c) => got.push(c)}
      />,
    )
    expect((submit() as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(handlesBox(), {
      target: { value: "@Alpha, beta  alpha" },
    })
    fireEvent.click(submit())
    expect(got).toEqual([
      { type: "cites", seeds: { kind: "handles", handles: ["alpha", "beta"] } },
    ])
  })

  test("opens on the handles it edits", () => {
    render(
      <HandlesEditor
        type="citedby"
        sets={sets}
        tags={tags}
        start={{
          type: "citedby",
          seeds: { kind: "handles", handles: ["a", "b"] },
        }}
        onSubmit={() => {}}
      />,
    )
    expect(handlesBox().value).toBe("a b")
    expect(screen.getByText("Cited by")).toBeTruthy()
  })

  test("fills the handles from the ticks, the selection or every follow (DFP-05)", () => {
    const got: DirectoryCond[] = []
    render(
      <HandlesEditor
        type="citedby"
        sets={sets}
        tags={tags}
        onSubmit={(c) => got.push(c)}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Every follow (3)" }))
    expect(handlesBox().value).toBe("@f1 @f2 @f3")
    fireEvent.click(screen.getByRole("button", { name: "Ticked here (2)" }))
    fireEvent.click(submit())
    expect(got).toEqual([
      { type: "citedby", seeds: { kind: "handles", handles: ["t1", "t2"] } },
    ])
    expect(
      screen.getByRole("button", { name: "Channels tab selection (1)" }),
    ).toBeTruthy()
  })

  test("past 500 handles it says so, points to a Tag and adds nothing", () => {
    render(
      <HandlesEditor
        type="cites"
        sets={sets}
        tags={tags}
        onSubmit={() => {}}
      />,
    )
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => `h${i}`).join(" ")
    fireEvent.change(handlesBox(), { target: { value: many(500) } })
    expect((submit() as HTMLButtonElement).disabled).toBe(false)
    fireEvent.change(handlesBox(), { target: { value: many(501) } })
    expect((submit() as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/501 channels.*500 at most.*Tag/)).toBeTruthy()
  })

  test("a Tag is a live source, sent by name", () => {
    const got: DirectoryCond[] = []
    render(
      <HandlesEditor
        type="cites"
        sets={sets}
        tags={tags}
        onSubmit={(c) => got.push(c)}
      />,
    )
    fireEvent.click(choice(/A Tag/))
    expect([...tagPicker().options].map((o) => o.value)).toEqual([
      "News",
      "group:Morning",
    ])
    fireEvent.change(tagPicker(), { target: { value: "group:Morning" } })
    fireEvent.click(submit())
    expect(got).toEqual([
      { type: "cites", seeds: { kind: "tag", name: "group:Morning" } },
    ])
  })

  test("opens on the Tag it edits; with no Tags the choice is off", () => {
    render(
      <HandlesEditor
        type="cites"
        sets={sets}
        tags={tags}
        start={{ type: "cites", seeds: { kind: "tag", name: "News" } }}
        onSubmit={() => {}}
      />,
    )
    expect(choice(/A Tag/).checked).toBe(true)
    expect(tagPicker().value).toBe("News")
    cleanup()
    render(
      <HandlesEditor
        type="cites"
        sets={sets}
        tags={noTags}
        onSubmit={() => {}}
      />,
    )
    expect(choice(/A Tag/).disabled).toBe(true)
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
  test("lists the six sources with their counts, the live ticks chosen first", () => {
    render(
      <SharedEditor
        type="parents"
        sets={sets}
        tags={tags}
        onSubmit={() => {}}
      />,
    )
    expect(screen.getByText("Compared with")).toBeTruthy()
    expect(choice(/ticked in this list \(2\)/).checked).toBe(true)
    expect(choice(/ticked in this list, saved now \(2\)/)).toBeTruthy()
    expect(choice(/Channels tab selection \(1\)/)).toBeTruthy()
    expect(choice(/Every channel you follow \(3\)/)).toBeTruthy()
    expect(choice(/These channels/)).toBeTruthy()
    expect(choice(/A Tag/)).toBeTruthy()
    // The live choice says a tick takes a Channel out of the results.
    expect(screen.getByText(/leaves the results/)).toBeTruthy()
  })

  test("with nothing ticked the two ticked choices are off", () => {
    render(
      <SharedEditor
        type="parents"
        sets={{ ...sets, ticked: [] }}
        tags={noTags}
        onSubmit={() => {}}
      />,
    )
    expect(choice(/ticked in this list \(0\)/).disabled).toBe(true)
    expect(choice(/saved now/).disabled).toBe(true)
    expect(choice(/Channels tab selection/).checked).toBe(true)
    expect(choice(/A Tag/).disabled).toBe(true)
  })

  test("each choice adds its Seeds and the minimum", () => {
    const got: DirectoryCond[] = []
    render(
      <SharedEditor
        type="children"
        sets={sets}
        tags={tags}
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
    fireEvent.click(choice(/A Tag/))
    fireEvent.click(submit())
    expect(got).toEqual([
      { type: "children", seeds: { kind: "ticked" }, min: 3 },
      {
        type: "children",
        seeds: { kind: "handles", handles: ["t1", "t2"] },
        min: 3,
      },
      { type: "children", seeds: { kind: "follows" }, min: 3 },
      {
        type: "children",
        seeds: { kind: "handles", handles: ["a", "b"] },
        min: 3,
      },
      { type: "children", seeds: { kind: "tag", name: "News" }, min: 3 },
    ])
  })

  test("a saved choice reopens as These channels, its handles to edit", () => {
    render(
      <SharedEditor
        type="parents"
        sets={sets}
        tags={tags}
        start={{
          type: "parents",
          seeds: { kind: "handles", handles: ["t1", "t2"] },
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

  test("a Tag choice reopens on its Tag", () => {
    render(
      <SharedEditor
        type="parents"
        sets={sets}
        tags={tags}
        start={{
          type: "parents",
          seeds: { kind: "tag", name: "group:Morning" },
          min: 2,
        }}
        onSubmit={() => {}}
      />,
    )
    expect(choice(/A Tag/).checked).toBe(true)
    expect(tagPicker().value).toBe("group:Morning")
  })

  test("Shared children says Seeds nobody follows find little", () => {
    render(
      <SharedEditor
        type="children"
        sets={sets}
        tags={tags}
        onSubmit={() => {}}
      />,
    )
    expect(screen.getByText(/only Channels somebody follows/i)).toBeTruthy()
  })
})
