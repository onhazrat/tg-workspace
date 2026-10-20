/** The row controls, props only (SET-02). The page itself is the Playwright spec's. */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { SettingRow } from "@/client"
import { Control, Highlight, numberRefusal } from "./controls"

afterEach(cleanup)

function row(overrides: Partial<SettingRow> = {}): SettingRow {
  return {
    id: "retention.yours.logDays",
    title: "Keep your logs for",
    description: "",
    topic: "retention",
    scope: "account",
    type: "integer",
    value: 7,
    default: 7,
    defaultSource: "env",
    modified: false,
    canEdit: true,
    lockReason: null,
    storage: "tg_user_settings.retention_prefs.logRetentionDays",
    min: 0,
    max: 30,
    ...overrides,
  }
}

const noop = () => {}

describe("Control", () => {
  test("a row the Account cannot change shows its value and why", () => {
    render(
      <Control
        row={row({ canEdit: false, lockReason: "Set by the Operator" })}
        error={null}
        onSave={noop}
        onCancel={noop}
      />,
    )
    expect(screen.getByText("· Set by the Operator")).toBeTruthy()
    expect(screen.queryByRole("textbox")).toBeNull()
  })

  test("on / off flips the value", () => {
    const onSave = mock()
    render(
      <Control
        row={row({ type: "boolean", value: true })}
        error={null}
        onSave={onSave}
        onCancel={noop}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "On" }))
    expect(onSave).toHaveBeenCalledWith(false)
  })

  test("a few choices are segments, many a pill", () => {
    const few = [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ]
    const onSave = mock()
    render(
      <Control
        row={row({ type: "enum", value: "a", options: few })}
        error={null}
        onSave={onSave}
        onCancel={noop}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "B" }))
    expect(onSave).toHaveBeenCalledWith("b")
    cleanup()
    const many = ["a", "b", "c", "d", "e"].map((v) => ({ value: v, label: v }))
    render(
      <Control
        row={row({ type: "enum", value: "c", options: many })}
        error={null}
        onSave={noop}
        onCancel={noop}
      />,
    )
    expect(screen.queryByRole("group")).toBeNull()
    expect(screen.getByText("Keep your logs for")).toBeTruthy()
  })

  test("a number saves on Enter, refuses out of bounds and undoes on Escape", () => {
    const onSave = mock()
    const onCancel = mock()
    render(
      <Control row={row()} error={null} onSave={onSave} onCancel={onCancel} />,
    )
    const field = screen.getByRole("textbox", { name: "Keep your logs for" })
    fireEvent.change(field, { target: { value: "99" } })
    fireEvent.keyDown(field, { key: "Enter" })
    expect(onSave).not.toHaveBeenCalled()
    expect(field.getAttribute("aria-invalid")).toBe("true")
    expect(screen.getByText("At most 30")).toBeTruthy()
    fireEvent.change(field, { target: { value: "12" } })
    fireEvent.keyDown(field, { key: "Enter" })
    expect(onSave).toHaveBeenCalledWith(12)
    fireEvent.change(field, { target: { value: "3" } })
    fireEvent.keyDown(field, { key: "Escape" })
    expect((field as HTMLInputElement).value).toBe("7")
    expect(onCancel).toHaveBeenCalled()
  })

  test("a server refusal marks the field and a JSON row parses its draft", () => {
    const onSave = mock()
    render(
      <Control
        row={row({ type: "json", value: null, min: null, max: null })}
        error="Refused"
        onSave={onSave}
        onCancel={noop}
      />,
    )
    const field = screen.getByRole("textbox")
    expect(field.getAttribute("aria-invalid")).toBe("true")
    fireEvent.change(field, { target: { value: "5" } })
    fireEvent.blur(field)
    expect(onSave).toHaveBeenCalledWith(5)
  })
})

describe("numberRefusal", () => {
  test("says what a number draft needs", () => {
    expect(numberRefusal(row(), "")).toBe("Enter a number")
    expect(numberRefusal(row(), "1.5")).toBe("A whole number")
    expect(numberRefusal(row(), "-1")).toBe("At least 0")
    expect(numberRefusal(row(), "5")).toBeNull()
  })
})

describe("Highlight", () => {
  test("marks searched words and ignores operators", () => {
    const { container } = render(
      <Highlight text="Keep your logs" query="logs @modified" />,
    )
    expect(container.querySelectorAll("mark")).toHaveLength(1)
    expect(container.querySelector("mark")?.textContent).toBe("logs")
  })
})
