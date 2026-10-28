/** The Telegram work panel's table (RKD-02), props only. */
import { afterEach, describe, expect, mock, test } from "bun:test"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import type { RequestKind, RequestKindSwitch, SyncLaneEntry } from "@/client"
import { queuedByKind, TelegramWorkTable } from "./telegram-work-panel"

afterEach(cleanup)

const sw = (
  kind: RequestKind,
  label: string,
  enabled = true,
  lanes: string[] = [],
): RequestKindSwitch => ({
  kind,
  label,
  settingId: `jobs.deployment.${kind}RequestsEnabled`,
  lanes,
  enabled,
  // Today, so the label is the time alone.
  disabledSince: enabled ? null : new Date().setHours(10, 32, 0, 0),
  refusal: `${label} is disabled on this deployment`,
})

const SWITCHES = [
  sw("auto", "Auto sync"),
  sw("probe", "Directory probe"),
  sw("botApi", "Bot API", false),
]

function table(onSet = mock((_s: RequestKindSwitch, _on: boolean) => {})) {
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
    expect(onSet.mock.calls.map(([s, on]) => [s.kind, on])).toEqual([
      ["probe", false],
    ])
  })

  test("enabling applies at once", () => {
    const onSet = table()
    fireEvent.click(within(row("Bot API")).getByRole("button"))
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(onSet.mock.calls.map(([s, on]) => [s.kind, on])).toEqual([
      ["botApi", true],
    ])
  })
})

test("queued sums the lanes each switch names; a lane no switch names is left out", () => {
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
    queuedByKind(
      [
        sw("auto", "Auto sync", true, [
          "auto_sync_normal",
          "auto_sync_best_effort",
        ]),
        sw("single", "Manual single", true, ["manual_single_normal"]),
        sw("probe", "Directory probe", true, ["discover_probe_background"]),
        sw("botApi", "Bot API"),
      ],
      [
        lane("auto_sync_normal", "auto_sync", 2),
        lane("auto_sync_best_effort", "auto_sync", 1),
        lane("manual_single_normal", "manual_single", 0),
        lane("discover_probe_background", null, 40),
        lane("something_else", null, 9),
      ],
    ),
  ).toEqual({ auto: 3, single: 0, probe: 40 })
})
