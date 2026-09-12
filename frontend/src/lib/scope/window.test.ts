/**
 * The Analysis window's rules (AW-03).
 *
 * What was here before was two numbers and three setters, and every one of
 * those setters repaired the pair when an edit crossed it. The repairs are what
 * these tests are really about: the same inputs that used to silently move a
 * boundary now have to come back as refusals that change nothing.
 *
 * Everything is driven by an explicit minute. No test waits, and none of them
 * reads a real clock, so a run at 23:59 means what a run at noon means.
 */

import { beforeEach, describe, expect, test } from "bun:test"

import { MINUTE_MS } from "@/lib/analysis-window"
import {
  applyField,
  DAY_MS,
  DEFAULT_WINDOW,
  ERRORS,
  fieldText,
  fixedRange,
  formatElapsed,
  formatLocalMinute,
  formatWindowSummary,
  HOUR_MS,
  loadWindow,
  parseElapsed,
  parseField,
  parseLocalMinute,
  resolveWindow,
  retireLegacyWindow,
  type ScopeField,
  saveWindow,
  switchMode,
  toWireWindow,
  WINDOW_STORAGE_KEY,
  type WindowState,
} from "@/lib/scope/window"
import { scopedStorage } from "@/lib/storage/scoped"

/** An arbitrary minute boundary, far enough from any edge to be boring. */
const NOW = Date.UTC(2026, 8, 11, 14, 30)

const live = (durationMs: number, endGapMs: number): WindowState => ({
  mode: "live",
  durationMs,
  endGapMs,
})

/** The four displayed values, which is all any of these tests should see. */
const four = (state: WindowState, minuteNow = NOW) => {
  const r = resolveWindow(state, minuteNow)
  return {
    start: r.start,
    end: r.end,
    durationMs: r.durationMs,
    endGapMs: r.endGapMs,
  }
}

const committed = (
  state: WindowState,
  field: ScopeField,
  value: number,
  minuteNow = NOW,
): WindowState => {
  const result = applyField(state, minuteNow, field, value)
  if (!result.ok) throw new Error(`expected a commit, got: ${result.error}`)
  return result.state
}

describe("canonical state", () => {
  test("a Live window derives its boundaries from the current minute", () => {
    expect(four(live(DAY_MS, 30 * MINUTE_MS))).toEqual({
      start: NOW - 30 * MINUTE_MS - DAY_MS,
      end: NOW - 30 * MINUTE_MS,
      durationMs: DAY_MS,
      endGapMs: 30 * MINUTE_MS,
    })
  })

  test("a Live window moves on its own as the minute advances", () => {
    const state = live(DAY_MS, 0)
    const later = NOW + 5 * MINUTE_MS

    expect(four(state, later).end).toBe(later)
    expect(four(state, later).durationMs).toBe(DAY_MS)
  })

  test("a Fixed window derives Duration and End gap, and stays put", () => {
    const state: WindowState = {
      mode: "fixed",
      start: NOW - 2 * HOUR_MS,
      end: NOW - HOUR_MS,
    }

    expect(four(state)).toEqual({
      start: NOW - 2 * HOUR_MS,
      end: NOW - HOUR_MS,
      durationMs: HOUR_MS,
      endGapMs: HOUR_MS,
    })
    // Ten minutes later only the gap has grown.
    expect(four(state, NOW + 10 * MINUTE_MS).end).toBe(NOW - HOUR_MS)
    expect(four(state, NOW + 10 * MINUTE_MS).endGapMs).toBe(
      HOUR_MS + 10 * MINUTE_MS,
    )
  })

  test("a new Account gets a 24-hour Live window with no gap", () => {
    expect(DEFAULT_WINDOW).toEqual(live(DAY_MS, 0))
  })
})

describe("propagation — each field holds exactly what it should", () => {
  const modes: { name: string; state: WindowState }[] = [
    { name: "Live", state: live(DAY_MS, 30 * MINUTE_MS) },
    {
      name: "Fixed",
      state: {
        mode: "fixed",
        start: NOW - 30 * MINUTE_MS - DAY_MS,
        end: NOW - 30 * MINUTE_MS,
      },
    },
  ]

  for (const { name, state } of modes) {
    test(`${name}: editing Start holds End and recalculates Duration`, () => {
      const before = four(state)
      const after = four(committed(state, "start", before.end - 2 * HOUR_MS))

      expect(after.end).toBe(before.end)
      expect(after.endGapMs).toBe(before.endGapMs)
      expect(after.durationMs).toBe(2 * HOUR_MS)
    })

    test(`${name}: editing End holds Start and recalculates Duration and End gap`, () => {
      const before = four(state)
      const after = four(committed(state, "end", NOW - 5 * MINUTE_MS))

      expect(after.start).toBe(before.start)
      expect(after.end).toBe(NOW - 5 * MINUTE_MS)
      expect(after.endGapMs).toBe(5 * MINUTE_MS)
      // The End moved 25 minutes later with the Start held, so that is exactly
      // how much longer the window got.
      expect(after.durationMs).toBe(before.durationMs + 25 * MINUTE_MS)
    })

    test(`${name}: editing Duration holds End and End gap, and moves Start`, () => {
      const before = four(state)
      const after = four(committed(state, "duration", 3 * HOUR_MS))

      expect(after.end).toBe(before.end)
      expect(after.endGapMs).toBe(before.endGapMs)
      expect(after.start).toBe(before.end - 3 * HOUR_MS)
    })

    test(`${name}: editing End gap holds Duration, and moves both boundaries`, () => {
      const before = four(state)
      const after = four(committed(state, "endGap", 2 * HOUR_MS))

      expect(after.durationMs).toBe(before.durationMs)
      expect(after.end).toBe(NOW - 2 * HOUR_MS)
      expect(after.start).toBe(NOW - 2 * HOUR_MS - before.durationMs)
    })

    test(`${name}: normal clock behaviour resumes after the edit`, () => {
      const after = committed(state, "duration", 3 * HOUR_MS)
      const later = NOW + 10 * MINUTE_MS

      // Live keeps moving; Fixed does not. That is the only difference an edit
      // is allowed to leave behind.
      expect(four(after, later).end).toBe(
        name === "Live" ? four(after).end + 10 * MINUTE_MS : four(after).end,
      )
    })
  }

  test("a Duration preset survives a non-zero End gap", () => {
    // The ticket's worked example: 30m gap, then the 24h Duration preset.
    const after = committed(live(HOUR_MS, 30 * MINUTE_MS), "duration", DAY_MS)

    expect(formatWindowSummary(resolveWindow(after, NOW), NOW)).toBe(
      "Live · 1d 30m ago → 30m ago (1d)",
    )
  })

  test("closing the gap then setting Duration is the last N hours, in both modes", () => {
    // What the Posts quick-range buttons say on the tin. A migrated Account is
    // Fixed and its End can be weeks old, so holding that End would make "24h"
    // mean a day three weeks ago.
    const stale: WindowState = {
      mode: "fixed",
      start: NOW - 21 * DAY_MS,
      end: NOW - 20 * DAY_MS,
    }
    const closed = committed(stale, "endGap", 0)
    const after = four(committed(closed, "duration", DAY_MS))

    expect(after.end).toBe(NOW)
    expect(after.start).toBe(NOW - DAY_MS)
  })

  test("a Fixed edit normalises away seconds and milliseconds", () => {
    const messy = NOW - HOUR_MS + 37_123
    const after = committed(
      { mode: "fixed", start: NOW - 2 * HOUR_MS, end: NOW - MINUTE_MS },
      "start",
      messy,
    )

    expect(four(after).start).toBe(NOW - HOUR_MS)
  })
})

describe("an invalid edit refuses instead of repairing", () => {
  const state = live(DAY_MS, 0)

  test("a Start past the End is an error, not a swap", () => {
    const result = applyField(state, NOW, "start", NOW + HOUR_MS)

    expect(result).toEqual({ ok: false, error: ERRORS.duration })
  })

  test("an End in the future is an error, not a clamp", () => {
    const result = applyField(state, NOW, "end", NOW + MINUTE_MS)

    expect(result).toEqual({ ok: false, error: ERRORS.future })
  })

  test("a Duration under one minute is refused", () => {
    expect(applyField(state, NOW, "duration", 0)).toEqual({
      ok: false,
      error: ERRORS.duration,
    })
    expect(applyField(state, NOW, "duration", MINUTE_MS).ok).toBe(true)
  })

  test("a zero End gap is fine — it is the default", () => {
    expect(applyField(state, NOW, "endGap", 0).ok).toBe(true)
  })

  test("the refused edit leaves the committed window exactly as it was", () => {
    const before = four(state)
    applyField(state, NOW, "end", NOW + MINUTE_MS)

    expect(four(state)).toEqual(before)
  })
})

describe("switching mode preserves the instant", () => {
  test("Live to Fixed freezes the four values it was showing", () => {
    const before = live(DAY_MS, 30 * MINUTE_MS)
    const after = switchMode(before, NOW, "fixed")

    expect(after.mode).toBe("fixed")
    expect(four(after)).toEqual(four(before))
  })

  test("Fixed to Live keeps Duration and End gap, then starts moving", () => {
    const before: WindowState = {
      mode: "fixed",
      start: NOW - 3 * HOUR_MS,
      end: NOW - HOUR_MS,
    }
    const after = switchMode(before, NOW, "live")

    expect(after).toEqual(live(2 * HOUR_MS, HOUR_MS))
    expect(four(after)).toEqual(four(before))
    expect(four(after, NOW + MINUTE_MS).end).toBe(NOW - HOUR_MS + MINUTE_MS)
  })

  test("switching to the mode already in force changes nothing", () => {
    const state = live(DAY_MS, 0)

    expect(switchMode(state, NOW, "live")).toBe(state)
  })
})

describe("the elapsed-time grammar", () => {
  test.each([
    ["1d 6h", DAY_MS + 6 * HOUR_MS],
    ["2h 30m", 2 * HOUR_MS + 30 * MINUTE_MS],
    ["  1d6h ", DAY_MS + 6 * HOUR_MS],
    ["30M", 30 * MINUTE_MS],
    ["0m", 0],
    ["7d", 7 * DAY_MS],
  ])("%s parses", (text, expected) => {
    expect(parseElapsed(text)).toBe(expected)
  })

  test.each([
    ["1.5h", "a fraction"],
    ["-1h", "a negative"],
    ["1y", "an unknown unit"],
    ["1h 2h", "a repeated unit"],
    ["30m 1h", "ascending order"],
    ["1h ago", "trailing text"],
    ["yesterday", "prose"],
    ["", "nothing"],
    ["5", "a bare number"],
  ])("%s is rejected — %s", (text) => {
    expect(parseElapsed(text)).toBeNull()
  })

  test.each([
    [0, "0m"],
    [MINUTE_MS, "1m"],
    [DAY_MS + 9 * HOUR_MS + 30 * MINUTE_MS, "1d 9h 30m"],
    [DAY_MS, "1d"],
    [30 * DAY_MS, "30d"],
  ])("%s formats as %s, and every rendering can be retyped", (ms, text) => {
    expect(formatElapsed(ms)).toBe(text)
    expect(parseElapsed(text)).toBe(ms)
  })
})

describe("exact instants stay local on screen and minute-aligned underneath", () => {
  test("a local date-time round-trips through the field", () => {
    const rendered = formatLocalMinute(NOW)

    expect(rendered).not.toContain("Z")
    expect(parseLocalMinute(rendered)).toBe(NOW)
  })

  test("seconds are dropped, and anything that is not a date-time is refused", () => {
    expect(parseLocalMinute("2026-09-10T09:30")).toBe(
      new Date("2026-09-10T09:30").getTime(),
    )
    expect(parseLocalMinute("2026-09-10")).toBeNull()
    expect(parseLocalMinute("tomorrow")).toBeNull()
  })

  test("a Duration is exact elapsed time, not a calendar day", () => {
    // A day is 24 hours whatever the local clock does in between. The window
    // spans a spring-forward Sunday in most northern zones.
    const spring = Date.UTC(2026, 2, 29, 12, 0)
    const after = committed(live(HOUR_MS, 0), "duration", DAY_MS, spring)

    expect(four(after, spring).start).toBe(spring - DAY_MS)
  })
})

describe("fields and the summary line", () => {
  const liveState = live(DAY_MS + 9 * HOUR_MS + 30 * MINUTE_MS, 30 * MINUTE_MS)
  const fixedState: WindowState = {
    mode: "fixed",
    start: new Date("2026-09-10T09:30").getTime(),
    end: new Date("2026-09-11T14:30").getTime(),
  }

  test("Live fields are relative in both directions", () => {
    const r = resolveWindow(liveState, NOW)

    expect(fieldText(r, NOW, "start")).toBe("1d 10h")
    expect(fieldText(r, NOW, "end")).toBe("30m")
    expect(fieldText(r, NOW, "duration")).toBe("1d 9h 30m")
    expect(fieldText(r, NOW, "endGap")).toBe("30m")
  })

  test("Fixed boundaries are exact local date-times", () => {
    const r = resolveWindow(fixedState, NOW)

    expect(fieldText(r, NOW, "start")).toBe(formatLocalMinute(fixedState.start))
    expect(fieldText(r, NOW, "duration")).toBe("1d 5h")
  })

  test("the Live summary reads as the spec writes it", () => {
    expect(formatWindowSummary(resolveWindow(liveState, NOW), NOW)).toBe(
      "Live · 1d 10h ago → 30m ago (1d 9h 30m)",
    )
  })

  test("a zero End gap says now rather than 0m ago", () => {
    expect(formatWindowSummary(resolveWindow(live(DAY_MS, 0), NOW), NOW)).toBe(
      "Live · 1d ago → now (1d)",
    )
  })

  test("the Fixed summary is exact, local, and carries no zone", () => {
    const line = formatWindowSummary(resolveWindow(fixedState, NOW), NOW)

    expect(line).toBe("Fixed · Sep 10 09:30 → Sep 11 14:30 (1d 5h)")
    expect(line).not.toMatch(/UTC|GMT|[+-]\d{2}:\d{2}/)
  })
})

describe("a typed field reaches the right kind of value", () => {
  test("Live boundaries are typed as elapsed, and become instants", () => {
    expect(parseField("live", NOW, "start", "2h")).toEqual({
      ok: true,
      value: NOW - 2 * HOUR_MS,
    })
    expect(parseField("live", NOW, "start", "2026-09-10T09:30")).toEqual({
      ok: false,
      error: ERRORS.grammar,
    })
  })

  test("Fixed boundaries are typed as date-times", () => {
    expect(parseField("fixed", NOW, "end", "2026-09-10T09:30")).toEqual({
      ok: true,
      value: new Date("2026-09-10T09:30").getTime(),
    })
    expect(parseField("fixed", NOW, "end", "2h")).toEqual({
      ok: false,
      error: ERRORS.timestamp,
    })
  })

  test("Duration and End gap are elapsed in either mode", () => {
    for (const mode of ["live", "fixed"] as const) {
      expect(parseField(mode, NOW, "duration", "1d 6h")).toEqual({
        ok: true,
        value: DAY_MS + 6 * HOUR_MS,
      })
    }
  })
})

describe("fixedRange — for values nobody typed", () => {
  test("a restored pair becomes Fixed as it stands", () => {
    expect(fixedRange(NOW - DAY_MS, NOW - HOUR_MS, NOW)).toEqual({
      mode: "fixed",
      start: NOW - DAY_MS,
      end: NOW - HOUR_MS,
    })
  })

  test("an end past the current minute is held, not refused", () => {
    // Unlike a typed edit: there is no field on screen to show a refusal in.
    expect(fixedRange(NOW - DAY_MS, NOW + DAY_MS, NOW).mode).toBe("fixed")
    expect(four(fixedRange(NOW - DAY_MS, NOW + DAY_MS, NOW)).end).toBe(NOW)
  })

  test("a crossed pair widens to the shortest legal window", () => {
    const state = fixedRange(NOW, NOW - HOUR_MS, NOW)

    expect(four(state).durationMs).toBe(MINUTE_MS)
  })
})

describe("toWireWindow — what a submission actually sends (AW-05)", () => {
  test("a Live window leaves as Live, not as the pair it resolves to", () => {
    // Flattening here would hand the server a selection made by this laptop's
    // clock and call it a choice, which is exactly what AW-02 removed.
    expect(toWireWindow(live(DAY_MS, 30 * MINUTE_MS))).toEqual({
      mode: "live",
      durationMinutes: 24 * 60,
      endGapMinutes: 30,
    })
  })

  test("a zero end gap survives, because it means the current minute", () => {
    expect(toWireWindow(DEFAULT_WINDOW)).toEqual({
      mode: "live",
      durationMinutes: 24 * 60,
      endGapMinutes: 0,
    })
  })

  test("a Fixed window travels as its two exact instants", () => {
    expect(
      toWireWindow({ mode: "fixed", start: NOW - DAY_MS, end: NOW }),
    ).toEqual({ mode: "fixed", start: NOW - DAY_MS, end: NOW })
  })
})

describe("persistence and the one-time migration", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  test("nothing stored means the default, not an invented window", () => {
    expect(loadWindow(NOW)).toEqual(DEFAULT_WINDOW)
  })

  test("Live persists what it is, and never a resolved timestamp", () => {
    saveWindow(live(DAY_MS, 30 * MINUTE_MS))
    const raw = scopedStorage.getItem(WINDOW_STORAGE_KEY) ?? ""

    expect(JSON.parse(raw)).toEqual({
      mode: "live",
      durationMs: DAY_MS,
      endGapMs: 30 * MINUTE_MS,
    })
    // A stored instant is the bug this replaces: it would freeze the window
    // into yesterday on the next reload.
    expect(raw).not.toContain(String(NOW))
    // A day later it is still the same 24 hours, ending half an hour ago.
    expect(four(loadWindow(NOW), NOW + DAY_MS).end).toBe(
      NOW + DAY_MS - 30 * MINUTE_MS,
    )
  })

  test("Fixed persists both instants and reloads unmoved", () => {
    const state: WindowState = {
      mode: "fixed",
      start: NOW - DAY_MS,
      end: NOW - HOUR_MS,
    }
    saveWindow(state)

    expect(loadWindow(NOW + DAY_MS)).toEqual(state)
  })

  test("a pair saved before AW-03 migrates to Fixed", () => {
    scopedStorage.setItem("startDateTs", String(NOW - DAY_MS))
    scopedStorage.setItem("endDateTs", String(NOW - HOUR_MS))

    expect(loadWindow(NOW)).toEqual({
      mode: "fixed",
      start: NOW - DAY_MS,
      end: NOW - HOUR_MS,
    })
  })

  test("loading reads and never writes, so a discarded render costs nothing", () => {
    scopedStorage.setItem("startDateTs", String(NOW - DAY_MS))
    scopedStorage.setItem("endDateTs", String(NOW - HOUR_MS))

    // `StrictMode` runs the initialiser twice and keeps the second answer. A
    // `loadWindow` that consumed the legacy keys would feed the real render
    // nothing and silently lose the Account's saved range.
    const first = loadWindow(NOW)

    expect(loadWindow(NOW)).toEqual(first)
    expect(scopedStorage.getItem("startDateTs")).not.toBeNull()
  })

  test("retiring the legacy pair happens once, and survives the default", () => {
    scopedStorage.setItem("startDateTs", String(NOW - DAY_MS))
    scopedStorage.setItem("endDateTs", String(NOW - HOUR_MS))

    retireLegacyWindow(loadWindow(NOW))

    expect(scopedStorage.getItem("startDateTs")).toBeNull()
    expect(scopedStorage.getItem("endDateTs")).toBeNull()
    expect(loadWindow(NOW)).toEqual({
      mode: "fixed",
      start: NOW - DAY_MS,
      end: NOW - HOUR_MS,
    })
  })

  test("a legacy end a fast clock pushed into the future is held, not dropped", () => {
    // The pre-AW-02 workspace wrote its end from this browser's raw
    // `Date.now()`, so a clock running fast — the case AW-02 exists for — left
    // a stored end slightly ahead. Refusing it would drop the saved window of
    // exactly the accounts that ticket protects.
    scopedStorage.setItem("startDateTs", String(NOW - DAY_MS))
    scopedStorage.setItem("endDateTs", String(NOW + MINUTE_MS))

    expect(loadWindow(NOW)).toEqual({
      mode: "fixed",
      start: NOW - DAY_MS,
      end: NOW,
    })
  })

  test("an old end sitting near now is still Fixed, not inferred Live", () => {
    scopedStorage.setItem("startDateTs", String(NOW - DAY_MS))
    scopedStorage.setItem("endDateTs", String(NOW))

    expect(loadWindow(NOW).mode).toBe("fixed")
  })

  test.each([
    ["not json at all", "{{{"],
    ["a mode nobody wrote", '{"mode":"rolling","durationMs":1}'],
    ["a Live window with no Duration", '{"mode":"live","endGapMs":0}'],
    [
      "a sub-minute Live Duration",
      '{"mode":"live","durationMs":5,"endGapMs":0}',
    ],
    ["a negative End gap", '{"mode":"live","durationMs":60000,"endGapMs":-1}'],
    [
      "a crossed Fixed pair",
      `{"mode":"fixed","start":${NOW},"end":${NOW - HOUR_MS}}`,
    ],
  ])("%s falls back to the default", (_name, raw) => {
    scopedStorage.setItem(WINDOW_STORAGE_KEY, raw)

    expect(loadWindow(NOW)).toEqual(DEFAULT_WINDOW)
  })

  test("a malformed legacy pair falls back to the default too", () => {
    scopedStorage.setItem("startDateTs", "yesterday")
    scopedStorage.setItem("endDateTs", "")

    expect(loadWindow(NOW)).toEqual(DEFAULT_WINDOW)
  })
})
