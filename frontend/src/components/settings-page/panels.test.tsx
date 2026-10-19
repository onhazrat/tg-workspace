/** The Settings page's own small panels, props only (SET-02). */
import { afterEach, describe, expect, mock, test } from "bun:test"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { BulkResync, JobRunRow, panelMatches, visiblePanels } from "./panels"

afterEach(cleanup)

describe("BulkResync", () => {
  test("asks first, then runs once", async () => {
    const onRun = mock(async () => ({
      channelsReset: 1,
      postsDeleted: 2,
      errors: [],
    }))
    render(<BulkResync onRun={onRun} />)
    fireEvent.click(
      screen.getByRole("button", { name: "Reset and sync all channels" }),
    )
    expect(onRun).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Reset and sync" }))
    await waitFor(() => expect(onRun).toHaveBeenCalledTimes(1))
  })

  test("a failure still closes the question", async () => {
    const onRun = mock(async () => {
      throw new Error("boom")
    })
    render(<BulkResync onRun={onRun} />)
    fireEvent.click(
      screen.getByRole("button", { name: "Reset and sync all channels" }),
    )
    fireEvent.click(screen.getByRole("button", { name: "Reset and sync" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })
})

describe("JobRunRow", () => {
  test("a job that never ran says so, a failed one shows its error", () => {
    const onRun = mock()
    render(
      <JobRunRow
        name="Retention"
        entry={undefined}
        running={false}
        onRun={onRun}
      />,
    )
    expect(screen.getByText("never run")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Run now" }))
    expect(onRun).toHaveBeenCalledTimes(1)
    cleanup()
    render(
      <JobRunRow
        name="Retention"
        entry={{
          enabled: true,
          lastRun: 1,
          lastStatus: "error",
          lastError: "x",
        }}
        running={false}
        onRun={onRun}
      />,
    )
    expect(screen.getByText("error · x").className).toContain("text-red-500")
  })
})

describe("visiblePanels", () => {
  test("a gated panel shows only to the Permission's holder", () => {
    const ids = (perms: string[]) => visiblePanels(perms).map((p) => p.id)
    expect(ids([])).not.toContain("operator.deployment.users")
    expect(ids(["users:read"])).toContain("operator.deployment.users")
    expect(ids([])).toContain("account.yours.profile")
  })

  test("search matches a panel's words", () => {
    const [signIn] = visiblePanels([])
    expect(signIn && panelMatches(signIn, ["logout"])).toBe(true)
    expect(signIn && panelMatches(signIn, ["zebra"])).toBe(false)
  })
})
