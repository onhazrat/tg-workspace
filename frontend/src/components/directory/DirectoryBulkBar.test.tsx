/**
 * The Directory's bulk bar (DIR-02): how many are ticked, a few of their
 * handles, Follow and Clear, and the confirmation Discover asks before five
 * or more.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { DirectoryBulkBar } from "./DirectoryBulkBar"

afterEach(cleanup)

function mount(handles: string[], busy = false, followed: string[] = []) {
  const calls = {
    follow: [] as string[][],
    dismiss: [] as string[][],
    clear: 0,
  }
  render(
    <DirectoryBulkBar
      ticks={new Set(handles)}
      busy={busy}
      followed={new Set(followed)}
      onFollow={(h) => calls.follow.push(h)}
      onDismiss={(h) => calls.dismiss.push(h)}
      onClear={() => calls.clear++}
    />,
  )
  return calls
}

describe("the bulk bar", () => {
  test("shows nothing while nothing is ticked", () => {
    mount([])
    expect(screen.queryByTestId("directory-bulk-bar")).toBeNull()
  })

  test("names the count and a few handles", () => {
    mount(["a", "b", "c", "d", "e"])
    expect(screen.getByText("5 ticked")).toBeTruthy()
    expect(screen.getByText("@a, @b, @c +2")).toBeTruthy()
  })

  test("follows fewer than five at once", () => {
    const calls = mount(["a", "b"])
    fireEvent.click(screen.getByRole("button", { name: "Follow 2" }))
    expect(calls.follow).toEqual([["a", "b"]])
  })

  test("asks first before five or more", () => {
    const calls = mount(["a", "b", "c", "d", "e"])
    fireEvent.click(screen.getByRole("button", { name: "Follow 5" }))
    expect(calls.follow).toEqual([])
    fireEvent.click(screen.getByTestId("directory-bulk-confirm"))
    expect(calls.follow).toEqual([["a", "b", "c", "d", "e"]])
  })

  test("Dismiss dismisses every tick at once, without asking", () => {
    const calls = mount(["a", "b", "c", "d", "e"])
    fireEvent.click(screen.getByRole("button", { name: "Dismiss 5" }))
    expect(calls.dismiss).toEqual([["a", "b", "c", "d", "e"]])
  })

  test("Clear empties the ticks, and a running follow holds both", () => {
    const calls = mount(["a"])
    fireEvent.click(screen.getByRole("button", { name: "Clear" }))
    expect(calls.clear).toBe(1)
    cleanup()
    mount(["a"], true)
    expect(
      (screen.getByRole("button", { name: "Clear" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  test("Follow and Dismiss act on the unfollowed ticks only, and say of how many", () => {
    // `followed` is lowercase; a tick keeps the handle's own case.
    const calls = mount(["a", "News", "c"], false, ["news"])
    expect(screen.getByText("3 ticked")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Follow 2 of 3" }))
    fireEvent.click(screen.getByRole("button", { name: "Dismiss 2 of 3" }))
    expect(calls.follow).toEqual([["a", "c"]])
    expect(calls.dismiss).toEqual([["a", "c"]])
  })

  test("asks first only when five or more would be followed", () => {
    const calls = mount(["a", "b", "c", "d", "e"], false, ["e"])
    fireEvent.click(screen.getByRole("button", { name: "Follow 4 of 5" }))
    expect(calls.follow).toEqual([["a", "b", "c", "d"]])
  })

  test("with only follows ticked, says so and offers neither Follow nor Dismiss", () => {
    mount(["a", "b"], false, ["a", "b"])
    expect(screen.getByText("All followed")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /^Follow/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /^Dismiss/ })).toBeNull()
    expect(screen.getByRole("button", { name: "Clear" })).toBeTruthy()
  })
})
