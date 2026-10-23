/** A Channel table row's own Requests, listed in a sheet (RQS-10). */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { RequestRecord, RequestRecordsResponse } from "@/client"
import { RequestList } from "./RequestsSheet"

afterEach(cleanup)

const record = (over: Partial<RequestRecord>): RequestRecord => ({
  id: "00000000-0000-0000-0000-000000000001",
  at: "2026-10-23T09:05:07.123456",
  latencyMs: 812,
  kind: "auto",
  charged: true,
  accountId: "00000000-0000-0000-0000-0000000000aa",
  email: "op@example.com",
  budget: "auto",
  bestEffort: false,
  channel: "durov",
  lane: "10.0.0.7:1080",
  pageType: "posts",
  outcome: "useful",
  cause: null,
  errorCode: null,
  attempt: 1,
  chainId: "00000000-0000-0000-0000-000000000001",
  newPosts: 20,
  repeatedPosts: 0,
  ...over,
})

const page = (
  records: RequestRecord[],
  counts = { total: records.length, useful: 0, idle: 0, wasted: 0 },
): RequestRecordsResponse => ({
  start: "2026-10-16T09:00:00",
  end: "2026-10-23T10:00:00",
  ...counts,
  records,
})

const cells = () =>
  screen
    .getAllByTestId("requests-record")
    .map((tr) =>
      [...tr.querySelectorAll("td")].map((td) => td.textContent?.trim()),
    )

describe("a Channel's Requests", () => {
  test("lists each Request with the counts by outcome over every page", () => {
    render(
      <RequestList
        aggregate={false}
        pages={[
          page(
            [
              record({}),
              record({
                id: "00000000-0000-0000-0000-000000000002",
                at: "2026-10-23T09:04:00",
                outcome: "wasted",
                cause: "turnedAway",
                errorCode: "429",
                attempt: 2,
                newPosts: null,
                repeatedPosts: null,
              }),
            ],
            { total: 9, useful: 4, idle: 3, wasted: 2 },
          ),
        ]}
      />,
    )
    const counts = screen.getByTestId("requests-record-counts").textContent
    expect(counts).toContain("9 Requests")
    expect(counts).toContain("4 useful")
    expect(counts).toContain("3 idle")
    expect(counts).toContain("2 wasted")
    expect(cells()).toEqual([
      [
        "2026-10-23 09:05:07",
        "Auto sync",
        "op@example.com",
        "10.0.0.7:1080",
        "useful",
        "",
        "",
        "1",
        "812",
        "20",
        "0",
      ],
      [
        "2026-10-23 09:04:00",
        "Auto sync",
        "op@example.com",
        "10.0.0.7:1080",
        "wasted",
        "Turned away",
        "429",
        "2",
        "812",
        "–",
        "–",
      ],
    ])
  })

  test("an aggregate row names each handle, and drops the columns nothing fills", () => {
    render(
      <RequestList
        aggregate
        pages={[
          page([
            record({
              kind: "probe",
              charged: false,
              accountId: null,
              email: null,
              channel: "someone",
              pageType: "metadata",
              newPosts: null,
              repeatedPosts: null,
            }),
          ]),
        ]}
      />,
    )
    const headers = screen
      .getAllByRole("columnheader")
      .map((th) => th.textContent)
    expect(headers).toContain("Handle")
    expect(headers).not.toContain("Account")
    expect(headers).not.toContain("New")
    expect(cells()[0][2]).toBe("@someone")
  })

  test("shows more while the server holds more, and says when there are none", () => {
    const more = mock(() => {})
    const { rerender } = render(
      <RequestList
        aggregate={false}
        pages={[page([record({})])]}
        onMore={more}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: /Show more/ }))
    expect(more).toHaveBeenCalledTimes(1)

    rerender(<RequestList aggregate={false} pages={[page([])]} />)
    expect(screen.queryByRole("button", { name: /Show more/ })).toBeNull()
    expect(screen.getByText("No Requests in this range.")).toBeTruthy()
  })

  test("says it is loading before the first page", () => {
    render(<RequestList aggregate={false} pages={undefined} />)
    expect(screen.getByText("Loading…")).toBeTruthy()
  })
})
