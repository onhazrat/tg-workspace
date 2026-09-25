import { afterEach, describe, expect, mock, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { JobRow, StartTimeSetting } from "./SyncSectionParts"

afterEach(cleanup)

const startProps = {
  highlightId: null,
  value: null,
  effectiveStartTime: 0,
  postRetentionDays: 0,
  onModeChange: () => {},
  onValueChange: () => {},
}

describe("StartTimeSetting", () => {
  test("choosing relative with no number seeds one day", () => {
    const onModeChange = mock()
    const onValueChange = mock()
    render(
      <StartTimeSetting
        {...startProps}
        mode="retention"
        onModeChange={onModeChange}
        onValueChange={onValueChange}
      />,
    )
    expect(screen.queryByRole("spinbutton")).toBeNull()
    expect(screen.queryByText(/Clamped by/)).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Relative" }))
    expect(onModeChange).toHaveBeenCalledWith("relative")
    expect(onValueChange).toHaveBeenCalledWith(1)
  })

  test("relative mode edits the day count and shows the retention clamp", () => {
    const onValueChange = mock()
    render(
      <StartTimeSetting
        {...startProps}
        mode="relative"
        value={3}
        postRetentionDays={30}
        onValueChange={onValueChange}
      />,
    )
    const input = screen.getByRole("spinbutton") as HTMLInputElement
    expect(input.value).toBe("3")
    expect(
      screen.getByText("Clamped by 30 days retention policy."),
    ).toBeTruthy()
    fireEvent.change(input, { target: { value: "" } })
    expect(onValueChange).toHaveBeenCalledWith(1)
  })

  test("absolute mode writes an ISO date and ignores an empty one", () => {
    const onValueChange = mock()
    const { container } = render(
      <StartTimeSetting
        {...startProps}
        mode="absolute"
        value="2026-01-02T03:04:05.000Z"
        onValueChange={onValueChange}
      />,
    )
    const input = container.querySelector(
      'input[type="datetime-local"]',
    ) as HTMLInputElement
    expect(input.value).toBe("2026-01-02T03:04")
    fireEvent.change(input, { target: { value: "2026-02-03T04:05" } })
    expect(onValueChange).toHaveBeenCalledWith(
      new Date("2026-02-03T04:05").toISOString(),
    )
  })
})

const jobProps = {
  label: "Retention",
  triggering: false,
  onToggle: () => {},
  onRun: () => {},
}

describe("JobRow", () => {
  test("an unknown job reads as enabled with no status", () => {
    const onToggle = mock()
    render(<JobRow {...jobProps} entry={undefined} onToggle={onToggle} />)
    expect(screen.getByText("—").className).toContain("text-app-ink/50")
    fireEvent.click(screen.getByTitle("Disable job"))
    expect(onToggle).toHaveBeenCalledWith(false)
  })

  test("a failed, disabled job shows its error and turns back on", () => {
    const onToggle = mock()
    const onRun = mock()
    render(
      <JobRow
        {...jobProps}
        entry={{
          enabled: false,
          lastRun: null,
          lastStatus: "error",
          lastError: "x".repeat(80),
        }}
        onToggle={onToggle}
        onRun={onRun}
      />,
    )
    const status = screen.getByText(`error · ${"x".repeat(60)}`)
    expect(status.className).toContain("text-red-500")
    fireEvent.click(screen.getByTitle("Enable job"))
    expect(onToggle).toHaveBeenCalledWith(true)
    fireEvent.click(screen.getByText("Run"))
    expect(onRun).toHaveBeenCalled()
  })
})
