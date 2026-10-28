/** The Telegram work panel's table (RKD-02), props only. */
import { afterEach, describe, expect, mock, test } from "bun:test"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import type { RequestKindSwitch, SyncLaneEntry } from "@/client"
import { queuedByKind, TelegramWorkTable } from "./telegram-work-panel"

afterEach(cleanup)

const sw = (
  kind: string,
  label: string,
  enabled = true,
): RequestKindSwitch => ({
  kind,
  label,
  enabled,
  disabledSince: enabled ? null : Date.parse("2026-10-28T10:32:00"),
  refusal: `${label} is disabled on this deployment`,
})

const SWITCHES = [
  sw("auto", "Auto sync"),
  sw("probe", "Directory probe"),
  sw("botApi", "Bot API", false),
]

function table(onSet = mock((_kind: string, _on: boolean) => {})) {
  render(
    <TelegramWorkTable
      switches={SWITCHES}
      lastDay={{ auto: 100, probe: 900 }}
      queued={{ auto: 3, probe: 40 }}
      onSet={onSet}
    />,
  )
  return onSet
}

const row = (label: string) =>
  screen.getByText(label).closest("tr") as HTMLElement
const cells = (tr: HTMLElement) =>
  [...tr.querySelectorAll("td")].map((td) => td.textContent)

describe("TelegramWorkTable", () => {
  test("each kind's last day, share, queued and pill", () => {
    table()
    expect(cells(row("Directory probe"))).toEqual([
      "Directory probe",
      "900",
      "90%",
      "40",
      "On",
    ])
    expect(cells(row("Bot API"))).toEqual([
      "Bot APIoff since 10:32",
      "0",
      "0.0%",
      "–",
      "Off",
    ])
  })

  test("disabling asks and states the impact; only Disable writes", () => {
    const onSet = table()
    fireEvent.click(within(row("Directory probe")).getByRole("button"))
    expect(onSet).not.toHaveBeenCalled()
    const dialog = screen.getByRole("dialog")
    expect(dialog.textContent).toContain(
      "900 Requests in the last 24 hours were Directory probe.",
    )
    expect(dialog.textContent).toContain("40 queued messages will wait")
    expect(dialog.textContent).toContain(
      '"Directory probe is disabled on this deployment"',
    )
    fireEvent.click(screen.getByTestId("telegram-work-confirm"))
    expect(onSet.mock.calls).toEqual([["probe", false]])
  })

  test("enabling applies at once", () => {
    const onSet = table()
    fireEvent.click(within(row("Bot API")).getByRole("button"))
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(onSet.mock.calls).toEqual([["botApi", true]])
  })
})

test("queued sums each kind's lanes; lanes of no kind are left out", () => {
  const lane = (
    name: string,
    budget: string | null,
    queued: number,
  ): SyncLaneEntry => ({
    lane: name,
    budget,
    tier: null,
    queued,
    paused: false,
  })
  expect(
    queuedByKind([
      lane("auto_sync_normal", "auto_sync", 2),
      lane("auto_sync_best_effort", "auto_sync", 1),
      lane("manual_single_normal", "manual_single", 0),
      lane("discover_probe_background", null, 40),
      lane("something_else", null, 9),
    ]),
  ).toEqual({ auto: 3, single: 0, probe: 40 })
})
