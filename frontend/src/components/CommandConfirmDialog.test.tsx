import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

import type { CommandContext, CommandDef } from "@/lib/commands/types"
import { CommandConfirmDialog } from "./CommandConfirmDialog"

afterEach(cleanup)

const command = {
  id: "danger",
  kind: "action",
  label: "Delete everything",
  keywords: [],
  group: "Test",
} as unknown as CommandDef

function mount() {
  const calls: string[] = []
  render(
    <CommandConfirmDialog
      command={command}
      context={{} as CommandContext}
      onConfirm={() => {
        calls.push("confirm")
      }}
      onCancel={() => calls.push("cancel")}
    />,
  )
  const root = screen.getByTestId("command-palette-confirm")
  const cancel = screen.getByTestId("command-palette-confirm-cancel")
  const confirm = screen.getByTestId("command-palette-confirm-confirm")
  return { calls, root, cancel, confirm }
}

describe("CommandConfirmDialog keyboard", () => {
  test("starts on Cancel, so Enter alone never runs the action", () => {
    const { calls, root, cancel } = mount()
    expect(document.activeElement).toBe(cancel)
    fireEvent.keyDown(root, { key: "Enter" })
    expect(calls).toEqual(["cancel"])
  })

  test("arrows toggle between the buttons and Enter runs the focused one", () => {
    const { calls, root, cancel, confirm } = mount()
    fireEvent.keyDown(root, { key: "ArrowRight" })
    expect(document.activeElement).toBe(confirm)
    fireEvent.keyDown(root, { key: "ArrowUp" })
    expect(document.activeElement).toBe(cancel)
    fireEvent.keyDown(root, { key: "ArrowDown" })
    fireEvent.keyDown(root, { key: "Enter" })
    expect(calls).toEqual(["confirm"])
  })

  test("ignores keys that neither move focus nor run", () => {
    const { calls, root, cancel } = mount()
    fireEvent.keyDown(root, { key: "a" })
    expect(document.activeElement).toBe(cancel)
    expect(calls).toEqual([])
  })

  test("falls back to the generic question when the command has none", () => {
    mount()
    expect(
      screen.getByText("Are you sure you want to run this action?"),
    ).toBeTruthy()
  })
})
