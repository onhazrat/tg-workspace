/**
 * The gate's rules (ADR-043, CW-02): what it says, what each control does to
 * the list, and what the action records. Every Action-tab button that freezes
 * a Scope goes through it; the component only shows the state this module
 * computes.
 */

import type { GateOutcome } from "@/client"
import type { BannerSync } from "./banner-sync"
import {
  byFix,
  incompleteOf,
  type Reason,
  type Verdict,
  type WindowCheck,
} from "./window-check"

/** Every Action-tab button that freezes a Scope. */
export type ActionKind =
  | "summary"
  | "summary-prompt"
  | "chat"
  | "tags"
  | "tags-prompt"
  | "discover"

export const ACTION_VERB: Record<ActionKind, string> = {
  summary: "Generate summary",
  "summary-prompt": "Copy summary prompt",
  chat: "Start a chat",
  tags: "Generate tags",
  "tags-prompt": "Copy tag prompt",
  discover: "Generate report",
}

/** ADR-043's wait for a person; "Continue now" ends it sooner. */
export const DEADLINE_MS = 5 * 60_000
/** Untouched, the gate syncs and continues by itself after this. */
export const AUTO_SYNC_SECONDS = 30

export type Choice = GateOutcome["choice"]

/**
 * The outcome the next submission sends, taken once: the gate sets it just
 * before its action runs, and the action's submission takes it, so a later
 * submission the gate did not run (a Chat's next turn) never carries it.
 */
let pending: GateOutcome | null = null
export const setGateOutcome = (outcome: GateOutcome | null) => {
  pending = outcome
}
export const takeGateOutcome = (): GateOutcome | undefined => {
  const outcome = pending ?? undefined
  pending = null
  return outcome
}

/** "23 Channels need attention, 150 just behind". */
export function gateTitle(incomplete: Verdict[]): string {
  const behind = incomplete.filter((c) => c.behind).length
  const problems = incomplete.length - behind
  const lag = `${behind} just behind`
  if (problems === 0)
    return `${behind} ${behind === 1 ? "Channel is" : "Channels are"} just behind`
  const head = `${problems} ${problems === 1 ? "Channel needs" : "Channels need"} attention`
  return behind ? `${head}, ${lag}` : head
}

/** A verdict with `reason` shown first, as the record will hold it. */
export function withReason(v: Verdict, reason: Reason): Verdict {
  return {
    ...v,
    reasons: [reason, ...v.reasons.filter((r) => r !== reason)],
    reason,
  }
}

/** What the check frozen at the click asks of the gate. */
export function verdictOf(check: WindowCheck): Choice | "review" {
  const incomplete = incompleteOf(check)
  if (incomplete.length === 0) return "complete"
  return incomplete.some((c) => c.syncable) ? "review" : "nothing_to_sync"
}

/** The Channels a sync can fix: the gate's Sync count. */
export const fixableNames = (check: WindowCheck | undefined) =>
  incompleteOf(check)
    .filter((c) => c.syncable)
    .map((c) => c.name)

/** Unfreeze is offered on a frozen row Telegram still serves. */
export const canUnfreeze = (c: Verdict) =>
  c.reasons.includes("frozen") && !c.reasons.includes("unavailable")

/** The row after Unfreeze: frozen no more, so a sync can fix it. */
export function unfrozen(c: Verdict): Verdict {
  const reasons = c.reasons.filter((r) => r !== "frozen")
  return { ...c, reasons, reason: reasons[0] ?? null, syncable: true }
}

/** The check with these Channels left out of it. */
export function leaveOut(check: WindowCheck, names: string[]): WindowCheck {
  const out = new Set(names)
  return { ...check, channels: check.channels.filter((c) => !out.has(c.name)) }
}

/**
 * How the gate's Sync covers each Channel: join a banner sync that started at
 * or after E (its head read passes), sync again after one that started before
 * E (its head read cannot), and sync the rest now.
 */
export function syncPlan(
  wanted: string[],
  banner: BannerSync | null,
  e: number,
) {
  const inFlight = (n: string) => !!banner?.names.has(n)
  const late = !!banner && banner.startedAt >= e
  return {
    join: wanted.filter((n) => inFlight(n) && late),
    after: wanted.filter((n) => inFlight(n) && !late),
    now: wanted.filter((n) => !inFlight(n)),
  }
}

/** "Synced 165: 160 now complete, 5 still not". */
export function syncedSaid(wanted: string[], still: Verdict[]): string {
  const left = new Set(still.map((c) => c.name))
  const fixed = wanted.filter((n) => !left.has(n)).length
  const rest = wanted.length - fixed
  return `Synced ${wanted.length}: ${fixed} now complete${rest ? `, ${rest} still not` : ""}`
}

/** What the record says each choice did to the Channels a sync could fix. */
export function outcomeOf(
  choice: Choice,
  frozenAt: number,
  check: WindowCheck | undefined,
  lists: { timedOut?: string[]; leftOut?: string[] } = {},
): GateOutcome {
  return {
    choice,
    frozenAt,
    skipped: choice === "skipped" ? fixableNames(check) : [],
    timedOut: lists.timedOut ?? [],
    leftOut: lists.leftOut ?? [],
  }
}

/** The rows, grouped as the gate shows them. */
export function gateGroups(check: WindowCheck | undefined) {
  const { problems, behind, stuck } = byFix(incompleteOf(check))
  return { problems, behind, stuck }
}
