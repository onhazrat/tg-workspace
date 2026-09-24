/**
 * One catalog row: the control its kind calls for, the Modified mark, and the
 * options menu. Props only, so it renders on its own.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type {
  SettingCatalogEntry,
  SettingControl,
} from "@/lib/settings/catalog-types"
import { parseSettingNumber, SettingRow } from "./SettingRow"

afterEach(cleanup)

const entry = (control: SettingControl, defaultValue: unknown) =>
  ({
    id: "sample",
    label: "Sample",
    description: "What it does",
    defaultValue,
    control,
  }) as unknown as SettingCatalogEntry

const options = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ value: `v${i}`, label: `L${i}` }))

describe("parseSettingNumber", () => {
  test("whole numbers unless the step is any; text that is no number is null", () => {
    expect(parseSettingNumber("2.5", 1)).toBe(2)
    expect(parseSettingNumber("2.5", "any")).toBe(2.5)
    expect(parseSettingNumber("", undefined)).toBeNull()
  })
})

describe("SettingRow", () => {
  test("a boolean is a switch that flips the value", () => {
    const onChange = mock()
    render(
      <SettingRow
        entry={entry({ kind: "boolean", commandSlug: "x" }, false)}
        value={false}
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getByRole("switch", { name: "Sample" }))
    expect(onChange).toHaveBeenCalledWith(true)
    expect(screen.getByText("What it does")).toBeTruthy()
    expect(screen.queryByText("Modified")).toBeNull()
  })

  test("a number stores what parses and ignores what does not", () => {
    const onChange = mock()
    render(
      <SettingRow
        entry={entry({ kind: "number", step: "any" }, 1)}
        value="3"
        onChange={onChange}
      />,
    )
    const input = screen.getByLabelText("Sample") as HTMLInputElement
    expect(input.value).toBe("3")
    fireEvent.change(input, { target: { value: "0.5" } })
    expect(onChange).toHaveBeenCalledWith(0.5)
    fireEvent.change(input, { target: { value: "" } })
    expect(onChange).toHaveBeenCalledTimes(1)
    // A modified row says so, on the row and in its data attribute.
    expect(screen.getByText("Modified")).toBeTruthy()
    expect(document.getElementById("setting-sample")?.dataset.modified).toBe(
      "true",
    )
  })

  test("a short enum is segments, a long one a select", () => {
    const onChange = mock()
    render(
      <SettingRow
        entry={entry(
          { kind: "enum", options: options(4), commandPrefix: "p" },
          "v0",
        )}
        value="v0"
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getByText("L2"))
    expect(onChange).toHaveBeenLastCalledWith("v2")
    expect(screen.queryByRole("combobox")).toBeNull()
    cleanup()
    render(
      <SettingRow
        entry={entry(
          { kind: "enum", options: options(5), commandPrefix: "p" },
          "v0",
        )}
        value="v0"
        onChange={onChange}
      />,
    )
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "v4" } })
    expect(onChange).toHaveBeenLastCalledWith("v4")
  })

  test("a panel has no inline control", () => {
    render(
      <SettingRow
        entry={entry({ kind: "panel", sectionId: "tor" }, null)}
        value={null}
        onChange={() => {}}
        id="custom-row"
        highlighted
      />,
    )
    expect(screen.queryByLabelText("Sample")).toBeNull()
    expect(document.getElementById("custom-row")).toBeTruthy()
  })

  test("reset puts the default back and is off while nothing changed", () => {
    const onChange = mock()
    const onReset = mock()
    const props = {
      entry: entry({ kind: "boolean", commandSlug: "x" }, false),
      onChange,
      onReset,
    }
    render(<SettingRow {...props} value={false} />)
    fireEvent.click(screen.getByLabelText("Options for Sample"))
    const reset = screen.getByText("Reset to default") as HTMLButtonElement
    expect(reset.disabled).toBe(true)
    cleanup()
    render(<SettingRow {...props} value />)
    fireEvent.click(screen.getByLabelText("Options for Sample"))
    fireEvent.click(screen.getByText("Reset to default"))
    expect(onChange).toHaveBeenCalledWith(false)
    expect(onReset).toHaveBeenCalledTimes(1)
    expect(screen.queryByText("Reset to default")).toBeNull()
  })
})
