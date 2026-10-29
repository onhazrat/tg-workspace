/**
 * The Groups dropdown the Directory and the Requests tab share (TGU-04): a row
 * per Setting group with its channels in the tab's scope, how many of them
 * the tab's selection holds, a gear between the name and the count that opens
 * the group in Settings, and the funnel.
 */
import { afterEach, expect, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { type GroupRow, GroupsDropdown } from "./GroupsDropdown"

afterEach(cleanup)

const GROUPS: GroupRow[] = [
  { id: "g-slow", name: "Slow", handles: ["a", "b"] },
  { id: "g-fast", name: "Fast", isDefault: true, handles: ["c"] },
]

function mount(selected: string[] = ["a"]) {
  const calls = {
    select: [] as [string[], boolean][],
    open: [] as string[],
    funnel: [] as [string, boolean][],
  }
  render(
    <GroupsDropdown
      testId="groups"
      tickHint="Select adds its channels"
      groups={GROUPS}
      selected={new Set(selected)}
      onSelect={(handles, on) => calls.select.push([handles, on])}
      funnelled={[]}
      onFunnel={(id, on) => calls.funnel.push([id, on])}
      onClearFunnels={() => {}}
      onOpen={(id) => calls.open.push(id)}
    />,
  )
  fireEvent.click(screen.getByTestId("groups"))
  return calls
}

const gear = (name: string) =>
  screen.getByRole("button", { name: `Open ${name}'s settings` })

test("each row's gear sits between its name and its count, and opens the group", () => {
  const calls = mount()
  const row = screen.getByTestId("groups-row-g-slow")
  const count = screen.getByTestId("groups-count-g-slow")
  const after = (a: Node, b: Node) =>
    (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
  expect(after(row, gear("Slow"))).toBe(true)
  expect(after(gear("Slow"), count)).toBe(true)
  expect(count.textContent).toBe("1/2")
  expect(screen.getByTestId("groups-count-g-fast").textContent).toBe("0/1")
  fireEvent.click(gear("Fast"))
  expect(calls.open).toEqual(["g-fast"])
})

test("selecting a group hands the tab its channels; a fully selected one takes them out", () => {
  const calls = mount(["a", "b"])
  fireEvent.click(screen.getByTestId("groups-row-g-fast"))
  fireEvent.click(screen.getByTestId("groups-row-g-slow"))
  expect(calls.select).toEqual([
    [["c"], true],
    [["a", "b"], false],
  ])
  fireEvent.click(screen.getByTestId("groups-funnel-g-slow"))
  expect(calls.funnel).toEqual([["g-slow", true]])
})
