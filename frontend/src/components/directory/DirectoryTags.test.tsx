/**
 * Tags in the Directory (DFP-04): a Channel's badges, the picker that puts a
 * Tag on or takes it off (or makes a new one), and the Tags menu that ticks a
 * Tag's Channels, renames it and deletes it after saying how many it is on.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { TagBadges, TagPicker, TagsMenu } from "./DirectoryTags"

afterEach(cleanup)

const TAGS = [
  { name: "News", channels: 3 },
  { name: "Tech", channels: 1 },
]

describe("badges", () => {
  test("show each Tag, and an x removes one when asked for", () => {
    const removed: string[] = []
    render(
      <TagBadges tags={["News", "Tech"]} onRemove={(n) => removed.push(n)} />,
    )
    expect(screen.getByTestId("directory-tags").textContent).toBe("NewsTech")
    fireEvent.click(screen.getByLabelText("Remove the Tag Tech"))
    expect(removed).toEqual(["Tech"])
  })

  test("show nothing for a Channel with no Tags", () => {
    render(<TagBadges tags={[]} />)
    expect(screen.queryByTestId("directory-tags")).toBeNull()
  })
})

function picker(over: Partial<Parameters<typeof TagPicker>[0]> = {}) {
  const calls = { pick: [] as string[], unpick: [] as string[] }
  render(
    <TagPicker
      tags={TAGS}
      current={["news"]}
      onPick={(n) => calls.pick.push(n)}
      onUnpick={(n) => calls.unpick.push(n)}
      trigger={<button type="button">open</button>}
      {...over}
    />,
  )
  fireEvent.click(screen.getByText("open"))
  return calls
}

const typeIn = (text: string) =>
  fireEvent.change(screen.getByTestId("directory-tag-search"), {
    target: { value: text },
  })

describe("the picker", () => {
  test("ticks the Tags the Channel has; choosing one takes it off, another puts it on", () => {
    const calls = picker()
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[]
    expect(boxes.map((b) => b.checked)).toEqual([true, false])
    fireEvent.click(boxes[0])
    expect(calls.unpick).toEqual(["News"])
    fireEvent.click(screen.getByText("open"))
    fireEvent.click(screen.getAllByRole("checkbox")[1])
    expect(calls.pick).toEqual(["Tech"])
  })

  test("a new name is created, and Enter on an existing one uses its spelling", () => {
    const calls = picker({ current: [] })
    typeIn("  Slow reads ")
    fireEvent.click(screen.getByText('Create the Tag "Slow reads"'))
    expect(calls.pick).toEqual(["Slow reads"])
    fireEvent.click(screen.getByText("open"))
    typeIn("tech")
    fireEvent.submit(screen.getByTestId("directory-tag-search"))
    expect(calls.pick).toEqual(["Slow reads", "Tech"])
  })

  test("a group: name is a Setting group's and is never created", () => {
    const calls = picker({ current: [] })
    typeIn("group:Fast")
    expect(screen.getByText(/belong to Setting groups/)).toBeTruthy()
    expect(screen.queryByText(/Create the Tag/)).toBeNull()
    fireEvent.submit(screen.getByTestId("directory-tag-search"))
    expect(calls.pick).toEqual([])
  })

  test("with create off only existing Tags are offered", () => {
    picker({ create: false, current: [] })
    typeIn("brand new")
    expect(screen.queryByText(/Create the Tag/)).toBeNull()
    expect(screen.getByText("No Tag matches")).toBeTruthy()
  })
})

function menu() {
  const calls = {
    tick: [] as string[],
    rename: [] as [string, string][],
    del: [] as string[],
  }
  render(
    <TagsMenu
      tags={TAGS}
      onTick={(n) => calls.tick.push(n)}
      onRename={(n, to) => calls.rename.push([n, to])}
      onDelete={(n) => calls.del.push(n)}
    />,
  )
  fireEvent.click(screen.getByTestId("directory-tags-menu"))
  return calls
}

describe("the Tags menu", () => {
  test("ticks exactly a Tag's Channels", () => {
    const calls = menu()
    fireEvent.click(screen.getByLabelText("Tick the channels in News"))
    expect(calls.tick).toEqual(["News"])
  })

  test("renames a Tag", () => {
    const calls = menu()
    fireEvent.click(screen.getByLabelText("Rename Tech"))
    const input = screen.getByLabelText("New name for Tech")
    fireEvent.change(input, { target: { value: "Science" } })
    fireEvent.submit(input)
    expect(calls.rename).toEqual([["Tech", "Science"]])
  })

  test("deletes a Tag only after saying how many Channels it is on", () => {
    const calls = menu()
    fireEvent.click(screen.getByLabelText("Delete News"))
    expect(calls.del).toEqual([])
    expect(screen.getByText(/"News" is on 3 channels/)).toBeTruthy()
    fireEvent.click(screen.getByTestId("directory-tag-delete-confirm"))
    expect(calls.del).toEqual(["News"])
  })
})
