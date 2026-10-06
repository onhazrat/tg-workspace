/**
 * The Directory's bulk bar (DIR-02): how many are ticked, a few of their
 * handles, Follow and Clear, and the confirmation Discover asks before five
 * or more.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { DirectoryBulkBar } from "./DirectoryBulkBar"

afterEach(cleanup)

function mount(handles: string[], busy = false) {
  const calls = {
    follow: [] as string[][],
    dismiss: [] as string[][],
    clear: 0,
  }
  render(
    <DirectoryBulkBar
      ticks={new Set(handles)}
      busy={busy}
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
})
