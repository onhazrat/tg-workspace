/** The Directory Refreshes panel (DRP-01, ADR-045), props only. */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import {
  parsePolicy,
  type RefreshPolicy,
  RefreshPolicyForm,
  writeOrder,
} from "./directory-refresh-panel"

afterEach(cleanup)

const SAVED: RefreshPolicy = { target: 20, minDays: 4, maxDays: 120 }

function form(
  projection: Parameters<typeof RefreshPolicyForm>[0]["projection"] = null,
) {
  const onDraft = mock((_p: RefreshPolicy | null) => {})
  const onSave = mock(async (_p: RefreshPolicy) => {})
  render(
    <RefreshPolicyForm
      saved={SAVED}
      projection={projection}
      onDraft={onDraft}
      onSave={onSave}
    />,
  )
  return { onDraft, onSave }
}

const edit = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
const save = () =>
  screen.getByTestId("refresh-policy-save") as HTMLButtonElement
const said = () => screen.getByTestId("refresh-projection").textContent

describe("RefreshPolicyForm", () => {
  test("asks for nothing until a value is edited", () => {
    const { onDraft } = form()
    expect(onDraft.mock.calls.at(-1)?.[0]).toBeNull()
    expect(save().disabled).toBe(true)
    expect(said()).toContain("Edit a value")
  })

  test("an edit is drafted, priced and saved whole", () => {
    const { onDraft, onSave } = form({
      refreshesPerDay: 42_300.4,
      atMin: 75_540,
      atMax: 289_700,
      measuredPerDay: 57_712,
    })
    edit("Refresh target", "40")
    expect(onDraft.mock.calls.at(-1)?.[0]).toEqual({ ...SAVED, target: 40 })
    expect(said()).toContain("About 42,300 Refreshes a day")
    expect(said()).toContain("75,540 entries wait the shortest")
    expect(said()).toContain("57,712 Requests a day last week")
    fireEvent.click(save())
    expect(onSave).toHaveBeenCalledWith({ ...SAVED, target: 40 })
  })

  test("a shortest wait above the longest is refused before it is sent", () => {
    const { onDraft } = form()
    edit("Shortest wait", "200")
    expect(save().disabled).toBe(true)
    expect(onDraft.mock.calls.at(-1)?.[0]).toBeNull()
    expect(screen.getByText(/shortest wait between Refreshes/)).toBeTruthy()
  })
})

describe("parsePolicy", () => {
  const drafts = (target: string, minDays: string, maxDays: string) => ({
    target,
    minDays,
    maxDays,
  })
  test("whole numbers within bounds", () => {
    expect(parsePolicy(drafts("20", "4", "120"))).toEqual(SAVED)
    expect(typeof parsePolicy(drafts("0", "4", "120"))).toBe("string")
    expect(typeof parsePolicy(drafts("1001", "4", "120"))).toBe("string")
    expect(typeof parsePolicy(drafts("20", "4.5", "120"))).toBe("string")
    expect(typeof parsePolicy(drafts("20", "", "120"))).toBe("string")
  })
})

describe("writeOrder", () => {
  test("only what changed, the longest wait first unless it drops below the stored shortest", () => {
    expect(writeOrder(SAVED, { ...SAVED, target: 40 })).toEqual(["target"])
    expect(
      writeOrder(SAVED, { target: 20, minDays: 150, maxDays: 200 }),
    ).toEqual(["maxDays", "minDays"])
    expect(writeOrder(SAVED, { target: 20, minDays: 1, maxDays: 2 })).toEqual([
      "minDays",
      "maxDays",
    ])
  })
})
