/**
 * The Request budgets card. What is pinned: an empty box is inherit (null) and
 * zero is a real limit, an account's draft comes from its own rows only, and
 * each button asks for the change it names.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"

import type {
  QuotaLimitsResponse,
  QuotaUsageResponse,
  UsersPublic,
} from "@/client"
import {
  QuotaLimitsCard,
  type QuotaLimitsCardProps,
  QuotaLimitsError,
  QuotaLimitsLoading,
} from "./QuotaLimitsParts"
import {
  budgetsFrom,
  type Draft,
  draftFrom,
  draftValue,
  inheritedText,
  liftedText,
  overrideDraftFor,
  parseLimit,
  showLimit,
  withLimit,
} from "./quota-limits-model"

afterEach(cleanup)

describe("the wire format of a box", () => {
  test("empty is inherit, zero is a limit, junk is inherit", () => {
    expect(parseLimit("")).toBeNull()
    expect(parseLimit("   ")).toBeNull()
    expect(parseLimit("0")).toBe(0)
    expect(parseLimit(" 12 ")).toBe(12)
    expect(parseLimit("7.9")).toBe(7)
    expect(parseLimit("-3.5")).toBe(-3)
    expect(parseLimit("abc")).toBeNull()
    expect(parseLimit("Infinity")).toBeNull()
  })

  test("a stored null shows as an empty box and a placeholder of no limit", () => {
    expect(showLimit(null)).toBe("")
    expect(showLimit(undefined)).toBe("")
    expect(showLimit(0)).toBe("0")
    expect(inheritedText(null)).toBe("no limit")
    expect(inheritedText(undefined)).toBe("no limit")
    expect(inheritedText(0)).toBe("0")
  })
})

describe("drafts", () => {
  test("every budget gets a row, missing ones empty", () => {
    expect(
      draftFrom([{ budget: "manual_bulk", allowance: 0, ceiling: null }]),
    ).toEqual({
      auto_sync: { allowance: "", ceiling: "" },
      manual_bulk: { allowance: "0", ceiling: "" },
      manual_single: { allowance: "", ceiling: "" },
    })
  })

  test("an account's draft comes from its own rows and nobody else's", () => {
    const overrides = [
      { userId: "a", budget: "auto_sync", allowance: 1, ceiling: 2 },
      { userId: "b", budget: "auto_sync", allowance: 9, ceiling: 9 },
    ]
    expect(overrideDraftFor(overrides, "a").auto_sync).toEqual({
      allowance: "1",
      ceiling: "2",
    })
    expect(overrideDraftFor(overrides, "c").auto_sync).toEqual({
      allowance: "",
      ceiling: "",
    })
    expect(overrideDraftFor(undefined, "a")).toEqual(draftFrom([]))
  })

  test("editing one field keeps the other and the other budgets", () => {
    const draft = draftFrom([{ budget: "auto_sync", allowance: 5, ceiling: 6 }])
    const next = withLimit(draft, "auto_sync", "ceiling", "")
    expect(next.auto_sync).toEqual({ allowance: "5", ceiling: "" })
    expect(next.manual_bulk).toBe(draft.manual_bulk)
    expect(withLimit({}, "auto_sync", "allowance", "3")).toEqual({
      auto_sync: { allowance: "3", ceiling: "" },
    })
  })

  test("a missing budget reads as an empty box", () => {
    expect(draftValue({}, "auto_sync", "ceiling")).toBe("")
  })

  test("the body names all three budgets, empty as null", () => {
    const draft: Draft = { auto_sync: { allowance: "0", ceiling: "" } }
    expect(budgetsFrom(draft)).toEqual([
      { budget: "auto_sync", allowance: 0, ceiling: null },
      { budget: "manual_bulk", allowance: null, ceiling: null },
      { budget: "manual_single", allowance: null, ceiling: null },
    ])
  })

  test("the Lifted column names each lifted budget, or a dash", () => {
    expect(liftedText(undefined)).toBe("—")
    expect(
      liftedText({
        userId: "a",
        email: "a",
        autoSyncLifted: true,
        manualSingleLifted: true,
      }),
    ).toBe("scheduled, single")
    expect(
      liftedText({ userId: "a", email: "a", manualBulkLifted: true }),
    ).toBe("bulk")
  })
})

describe("loading and error", () => {
  test("say so under the card title", () => {
    render(<QuotaLimitsLoading />)
    expect(screen.getByText("Request budgets")).toBeTruthy()
    cleanup()
    render(<QuotaLimitsError />)
    expect(screen.getByText("Budgets could not be loaded.")).toBeTruthy()
  })
})

const limits: QuotaLimitsResponse = {
  defaults: [{ budget: "auto_sync", allowance: 100, ceiling: null }],
  overrides: [
    {
      userId: "u2",
      email: "b@x",
      budget: "manual_single",
      allowance: 3,
      ceiling: null,
    },
  ],
}
const users = {
  data: [
    { id: "u1", email: "a@x" },
    { id: "u2", email: "b@x" },
  ],
  count: 2,
} as UsersPublic
const usage: QuotaUsageResponse = {
  day: "d",
  entries: [{ userId: "u1", email: "a@x", total: 7, autoSyncLifted: true }],
}

function Harness(overrides: Partial<QuotaLimitsCardProps> & { log: string[] }) {
  const { log, ...rest } = overrides
  const [defaultsDraft, setDefaultsDraft] = useState<Draft>(draftFrom([]))
  const [overrideDraft, setOverrideDraft] = useState<Draft>(draftFrom([]))
  const [overrideUser, setOverrideUser] = useState("")
  return (
    <QuotaLimitsCard
      limits={limits}
      users={users}
      usage={usage}
      defaultsDraft={defaultsDraft}
      setDefaultsDraft={setDefaultsDraft}
      savingDefaults={false}
      onSaveDefaults={() =>
        log.push(`defaults ${JSON.stringify(budgetsFrom(defaultsDraft))}`)
      }
      overrideUser={overrideUser}
      onOverrideUserChange={setOverrideUser}
      overrideDraft={overrideDraft}
      setOverrideDraft={setOverrideDraft}
      savingOverride={false}
      onSaveOverride={() => log.push(`override ${overrideUser}`)}
      onClearOverride={(row) => log.push(`clear ${row.userId} ${row.budget}`)}
      lifting={false}
      onLift={(id) => log.push(`lift ${id}`)}
      {...rest}
    />
  )
}

describe("the card", () => {
  test("placeholders show the resolved default, boxes the stored one", () => {
    render(<Harness log={[]} />)
    const allowance = screen.getAllByLabelText(
      /allowance$/,
    )[0] as HTMLInputElement
    expect(allowance.placeholder).toBe("100")
    expect(allowance.value).toBe("")
    expect(
      (screen.getAllByLabelText(/limit$/)[0] as HTMLInputElement).placeholder,
    ).toBe("no limit")
  })

  test("typing into a default box is what Save defaults sends", () => {
    const log: string[] = []
    render(<Harness log={log} />)
    fireEvent.change(screen.getAllByLabelText(/allowance$/)[0], {
      target: { value: "0" },
    })
    fireEvent.change(screen.getAllByLabelText(/limit$/)[1], {
      target: { value: "4" },
    })
    fireEvent.click(screen.getByText("Save defaults"))
    expect(log).toEqual([
      `defaults ${JSON.stringify([
        { budget: "auto_sync", allowance: 0, ceiling: null },
        { budget: "manual_bulk", allowance: null, ceiling: 4 },
        { budget: "manual_single", allowance: null, ceiling: null },
      ])}`,
    ])
  })

  test("the override table appears once an account is picked", () => {
    const log: string[] = []
    render(<Harness log={log} />)
    expect(screen.queryByText("Save override")).toBeNull()
    expect(screen.getAllByLabelText(/allowance$/)).toHaveLength(3)
    fireEvent.change(screen.getByLabelText("Account to override"), {
      target: { value: "u2" },
    })
    expect(screen.getAllByLabelText(/allowance$/)).toHaveLength(6)
    fireEvent.change(screen.getAllByLabelText(/allowance$/)[3], {
      target: { value: "9" },
    })
    expect(
      (screen.getAllByLabelText(/allowance$/)[3] as HTMLInputElement).value,
    ).toBe("9")
    fireEvent.click(screen.getByText("Save override"))
    expect(log).toEqual(["override u2"])
  })

  test("saving shows on the button and disables it", () => {
    render(<Harness log={[]} savingDefaults overrideUser="u1" savingOverride />)
    const saving = screen.getAllByText("Saving…") as HTMLButtonElement[]
    expect(saving).toHaveLength(2)
    expect(saving.every((b) => b.disabled)).toBe(true)
  })

  test("existing overrides list each row and clear exactly that one", () => {
    const log: string[] = []
    render(<Harness log={log} />)
    expect(screen.getAllByText("inherits")).toHaveLength(1)
    fireEvent.click(screen.getByText("Clear"))
    expect(log).toEqual(["clear u2 manual_single"])
  })

  test("with no overrides and no accounts, each section says so", () => {
    render(
      <Harness
        log={[]}
        limits={{}}
        users={{ data: [], count: 0 } as UsersPublic}
        usage={undefined}
      />,
    )
    expect(screen.getByText("No account overrides the defaults.")).toBeTruthy()
    expect(screen.getByText("No accounts.")).toBeTruthy()
    expect(
      (screen.getAllByLabelText(/allowance$/)[0] as HTMLInputElement)
        .placeholder,
    ).toBe("no limit")
  })

  test("with nothing loaded yet, the lists are empty rather than broken", () => {
    render(<Harness log={[]} limits={undefined} users={undefined} />)
    expect(screen.getByText("No accounts.")).toBeTruthy()
  })

  test("the lift table shows spend and lifts, and lifts the account asked", () => {
    const log: string[] = []
    render(<Harness log={log} />)
    const rows = screen.getAllByText("Lift until midnight")
    expect(rows).toHaveLength(2)
    expect(screen.getByText("7")).toBeTruthy()
    expect(screen.getByText("scheduled")).toBeTruthy()
    expect(screen.getByText("—")).toBeTruthy()
    fireEvent.click(rows[1])
    expect(log).toEqual(["lift u2"])
  })

  test("a lift in flight disables every lift button", () => {
    render(<Harness log={[]} lifting />)
    for (const b of screen.getAllByText("Lift until midnight")) {
      expect((b as HTMLButtonElement).disabled).toBe(true)
    }
  })
})
