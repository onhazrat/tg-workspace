/**
 * Tags in the Directory (DFP-04): a Channel's badges, the picker that puts a
 * Tag on or takes it off (or makes a new one). The Tags dropdown that selects,
 * renames and deletes is `TagsDropdown` (TGU-03).
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { TagBadges, TagPicker } from "./DirectoryTags"

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

describe("a group: Tag (story 23)", () => {
  const WITH_GROUP = [...TAGS, { name: "group:Fast", channels: 2 }]

  test("shows as a badge with no x, since a Setting group owns it", () => {
    render(<TagBadges tags={["News", "group:Fast"]} onRemove={() => {}} />)
    expect(screen.getByTestId("directory-tags").textContent).toBe(
      "Newsgroup:Fast",
    )
    expect(screen.getByLabelText("Remove the Tag News")).toBeTruthy()
    expect(screen.queryByLabelText("Remove the Tag group:Fast")).toBeNull()
  })

  test("is never offered by the picker, to put on or take off", () => {
    picker({ tags: WITH_GROUP, current: ["group:Fast"] })
    expect(screen.queryByText("group:Fast")).toBeNull()
    expect(screen.getAllByRole("checkbox")).toHaveLength(2)
  })
})
