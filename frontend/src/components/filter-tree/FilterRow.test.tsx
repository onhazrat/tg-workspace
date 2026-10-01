/**
 * The shared filter row and condition picker (PTR-01) over a toy vocabulary,
 * so they are tested without any tab's Conditions: what the vocabulary says
 * is what the chips, test ids and picker show, and a pick reaches the tree.
 * The Channels wrappers keep their own tests in `channel-grid/`.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { Circle, Ruler } from "lucide-react"
import type React from "react"
import { emptyTree, type FilterTree } from "@/lib/filter-tree"
import { ConditionPicker } from "./ConditionPicker"
import { FilterRow, type FilterVocabulary } from "./FilterRow"

afterEach(cleanup)

type Toy = { type: "colour"; value: string } | { type: "size"; min: number }

const vocabulary: FilterVocabulary<Toy> = {
  sections: [
    {
      entries: [
        {
          kind: "list",
          id: "colour",
          label: "Colour",
          icon: Circle,
          options: [
            { id: "red", label: "Red" },
            { id: "blue", label: "Blue", hint: "b" },
          ],
          make: (value) => ({ type: "colour", value }),
          current: (cond) => (cond.type === "colour" ? cond.value : undefined),
        },
        {
          kind: "list",
          id: "empty",
          label: "Nothing here",
          icon: Circle,
          options: [],
          make: (value) => ({ type: "colour", value }),
          current: () => undefined,
        },
      ],
    },
    {
      heading: "Numbers",
      entries: [
        {
          kind: "editor",
          id: "size",
          label: "Size",
          icon: Ruler,
          render: ({ start, onSubmit, onBack }) => (
            <span>
              <span data-testid="size-start">
                {start?.type === "size" ? start.min : "none"}
              </span>
              <button
                type="button"
                onClick={() => onSubmit({ type: "size", min: 7 })}
              >
                Apply size
              </button>
              <button type="button" onClick={onBack}>
                Back
              </button>
            </span>
          ),
        },
      ],
    },
  ],
  entryOf: (cond) => cond.type,
  label: (cond) =>
    cond.type === "colour" ? `Colour ${cond.value}` : `Size ≥ ${cond.min}`,
  icon: (cond) => (cond.type === "colour" ? Circle : Ruler),
  chipId: (cond) => (cond.type === "colour" ? cond.value : "size"),
}

const tree = (...conds: Toy[]): FilterTree<Toy> => ({
  ...emptyTree<Toy>(),
  children: conds.map((cond, i) => ({ kind: "atom", id: `a${i}`, cond })),
})

function mount(over: Partial<React.ComponentProps<typeof FilterRow<Toy>>>) {
  const changes: FilterTree<Toy>[] = []
  render(
    <FilterRow<Toy>
      filter={emptyTree()}
      onChange={(next) => changes.push(next)}
      vocabulary={vocabulary}
      testId="toy"
      search=""
      shownCount={2}
      totalCount={5}
      onClearSearch={() => {}}
      onClearAll={() => {}}
      {...over}
    />,
  )
  return changes
}

const conds = (filter: FilterTree<Toy>) =>
  filter.children.map((child) => child.kind === "atom" && child.cond)

describe("FilterRow", () => {
  test("renders nothing while nothing filters", () => {
    mount({})
    expect(screen.queryByTestId("toy-row")).toBeNull()
  })

  test("chips take their label, icon and test id from the vocabulary", () => {
    mount({
      filter: tree({ type: "colour", value: "red" }, { type: "size", min: 3 }),
    })
    expect(screen.getByTestId("toy-row")).toBeTruthy()
    expect(screen.getByTestId("toy-chip-red").textContent).toContain(
      "Colour red",
    )
    expect(screen.getByTestId("toy-chip-size").textContent).toContain(
      "Size ≥ 3",
    )
    expect(screen.getByTestId("toy-count").textContent).toBe("2 of 5")
    expect(screen.getByTestId("toy-count").getAttribute("title")).toBeNull()
  })

  test("an approximate count reads ≈ and says why", () => {
    mount({
      filter: tree({ type: "colour", value: "red" }),
      approximate: "Counted on the loaded pages",
    })
    const count = screen.getByTestId("toy-count")
    expect(count.textContent).toBe("≈ 2 of 5")
    expect(count.getAttribute("title")).toBe("Counted on the loaded pages")
  })

  test("+ picks from a list; a list with no options is not offered", () => {
    const changes = mount({ filter: tree({ type: "size", min: 3 }) })
    fireEvent.click(screen.getByRole("button", { name: "Add a condition" }))
    expect(screen.queryByRole("button", { name: /Nothing here/ })).toBeNull()
    expect(screen.getByText("Numbers")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /Colour/ }))
    fireEvent.click(screen.getByRole("button", { name: /Blue/ }))
    expect(conds(changes[0])).toEqual([
      { type: "size", min: 3 },
      { type: "colour", value: "blue" },
    ])
  })

  test("a chip's label opens its own list with its value marked", () => {
    const changes = mount({ filter: tree({ type: "colour", value: "red" }) })
    fireEvent.click(screen.getByRole("button", { name: "Colour red" }))
    expect(
      screen.getByRole("button", { name: "Red" }).getAttribute("aria-current"),
    ).toBe("true")
    fireEvent.click(screen.getByRole("button", { name: /Blue/ }))
    expect(conds(changes[0])).toEqual([{ type: "colour", value: "blue" }])
  })
})

describe("ConditionPicker", () => {
  function pick(start?: Toy) {
    const picked: Toy[] = []
    render(
      <ConditionPicker<Toy>
        start={start}
        vocabulary={vocabulary}
        onPick={(cond) => picked.push(cond)}
        trigger={<button type="button">open</button>}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "open" }))
    return picked
  }

  test("an editor entry renders the tab's editor and submits its Condition", () => {
    const picked = pick()
    fireEvent.click(screen.getByRole("button", { name: /Size/ }))
    expect(screen.getByTestId("size-start").textContent).toBe("none")
    fireEvent.click(screen.getByRole("button", { name: "Apply size" }))
    expect(picked).toEqual([{ type: "size", min: 7 }])
  })

  test("opened on a Condition, its editor starts from it, and Back lists all", () => {
    pick({ type: "size", min: 4 })
    expect(screen.getByTestId("size-start").textContent).toBe("4")
    fireEvent.click(screen.getByRole("button", { name: "Back" }))
    expect(screen.getByPlaceholderText("Search conditions...")).toBeTruthy()
  })

  test("the search narrows the kinds and then the values", () => {
    pick()
    fireEvent.change(screen.getByPlaceholderText("Search conditions..."), {
      target: { value: "Si" },
    })
    expect(screen.queryByRole("button", { name: /Colour/ })).toBeNull()
    fireEvent.change(screen.getByPlaceholderText("Search conditions..."), {
      target: { value: "" },
    })
    fireEvent.click(screen.getByRole("button", { name: /Colour/ }))
    fireEvent.change(screen.getByPlaceholderText("Search colours..."), {
      target: { value: "re" },
    })
    expect(screen.queryByRole("button", { name: /Blue/ })).toBeNull()
    expect(screen.getByRole("button", { name: "Red" })).toBeTruthy()
  })
})
