import { afterEach, describe, expect, mock, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { QueryPanel } from "./QueryPanel"
import { RetentionPanel } from "./RetentionPanel"

afterEach(cleanup)

const queryProps = {
  selectedTable: "posts",
  query: "",
  queryResults: null,
  queryError: null,
  isQuerying: false,
  onQueryChange: () => {},
  onRunQuery: () => {},
}

describe("QueryPanel", () => {
  test("renders nothing without a table", () => {
    const { container } = render(
      <QueryPanel {...queryProps} selectedTable="" />,
    )
    expect(container.innerHTML).toBe("")
  })

  test("shows the error, a capped result count and the server warning", () => {
    render(
      <QueryPanel
        {...queryProps}
        isServerSource
        queryError="bad query"
        queryResults={Array.from({ length: 100 }, (_, i) => i)}
      />,
    )
    expect(screen.getByText("bad query")).toBeTruthy()
    expect(screen.getByText(/Results \(100\+\)/)).toBeTruthy()
    expect(screen.getByText(/not the backend DB/)).toBeTruthy()
  })

  test("an empty result says so, and Enter runs the query", () => {
    const onRunQuery = mock()
    render(
      <QueryPanel {...queryProps} queryResults={[]} onRunQuery={onRunQuery} />,
    )
    expect(screen.getByText("No results found.")).toBeTruthy()
    expect(screen.queryByText(/not the backend DB/)).toBeNull()
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" })
    expect(onRunQuery).toHaveBeenCalled()
  })
})

describe("RetentionPanel", () => {
  const retention = (days: number) => ({
    postRetentionDays: days,
    logRetentionDays: days,
    sharedLogRetentionDays: days,
    payloadRetentionDays: days,
    reportRetentionDays: days,
    reportRetentionMax: days,
    onPostRetentionDaysChange: () => {},
    onLogRetentionDaysChange: () => {},
    onSharedLogRetentionDaysChange: () => {},
    onPayloadRetentionDaysChange: () => {},
    onReportRetentionDaysChange: () => {},
    onReportRetentionMaxChange: () => {},
  })

  test("zero means keep forever, and a bad entry clamps to zero", () => {
    const onPost = mock()
    render(
      <RetentionPanel {...retention(0)} onPostRetentionDaysChange={onPost} />,
    )
    expect(screen.getByText(/posts are kept forever/)).toBeTruthy()
    const [post] = screen.getAllByRole("spinbutton")
    fireEvent.change(post as HTMLElement, { target: { value: "-4" } })
    expect(onPost).toHaveBeenCalledWith(0)
  })

  test("a positive window drops the keep-forever notes", () => {
    render(<RetentionPanel {...retention(7)} highlightId="logRetentionDays" />)
    expect(screen.queryByText(/kept forever/)).toBeNull()
  })
})
