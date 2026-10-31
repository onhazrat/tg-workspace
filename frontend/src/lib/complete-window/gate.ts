/**
 * The gate's rules (ADR-043, CW-02). What it says, what each control does to
 * the list, and what the action records. Every Action-tab button that freezes
 * a Scope goes through it; the flow (`gate-flow.ts`) runs these, and the
 * component only shows the state the flow keeps.
 */

import type { GateOutcome } from "@/client"
import {
  incompleteOf,
  span,
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

export type GateChoice = GateOutcome["choice"]

/**
 * The outcome the next submission sends, taken once. The gate sets it just
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

/**
 * A submission with the gate's outcome taken, when the gate ran this action;
 * without one the server records the Artifact as not checked.
 */
export function withGate<T extends object>(
  submission: T,
): T & { gate?: GateOutcome } {
  return { ...submission, gate: takeGateOutcome() }
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

/** What the check frozen at the click asks of the gate. */
export function verdictOf(check: WindowCheck): GateChoice | "review" {
  const incomplete = incompleteOf(check)
  if (incomplete.length === 0) return "complete"
  return incomplete.some((c) => c.syncable) ? "review" : "nothing_to_sync"
}

/** The Incomplete Channels a sync can fix. */
export const fixableOf = (check: WindowCheck | undefined) =>
  incompleteOf(check).filter((c) => c.syncable)

/** Their names, the gate's Sync count. */
export const fixableNames = (check: WindowCheck | undefined) =>
  fixableOf(check).map((c) => c.name)

/** Unfreeze is offered on a frozen row Telegram still serves. */
export const canUnfreeze = (c: Verdict) =>
  c.reasons.includes("frozen") && !c.reasons.includes("unavailable")

/** The row after Unfreeze, frozen no more, so a sync can fix it. */
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
 * A check as the gate shows it after its edits, Left out gone and an
 * unfrozen row unfrozen even when the check read it before the move landed.
 */
export function withEdits(
  check: WindowCheck,
  edits: { leftOut: string[]; unfrozen: string[] },
): WindowCheck {
  const thawed = new Set(edits.unfrozen)
  const kept = leaveOut(check, edits.leftOut)
  return {
    ...kept,
    channels: kept.channels.map((c) =>
      thawed.has(c.name) && c.reasons.includes("frozen") ? unfrozen(c) : c,
    ),
  }
}

const names = (list: Verdict[]) => list.map((c) => c.name)

/**
 * How the gate's Sync covers each Channel, from the check's own answer about
 * the syncs in flight (any Account's). Join one that will read its head after
 * E, queue another behind one that already read it before E, and sync the
 * rest at once.
 */
export function syncPlan(wanted: Verdict[]) {
  return {
    join: names(wanted.filter((c) => c.syncingSince != null && !c.syncAgain)),
    after: names(wanted.filter((c) => c.syncAgain)),
    atOnce: names(wanted.filter((c) => c.syncingSince == null)),
  }
}

/**
 * The Channels whose sync walks back to the window's Start, past the Posts
 * it holds, the ones short of the Start or holed.
 */
export function walkBack(wanted: Verdict[], start: number) {
  return Object.fromEntries(
    wanted
      .filter((c) => c.reasons.includes("start") || c.reasons.includes("hole"))
      .map((c) => [c.name, start]),
  )
}

/** "Synced 165: 160 now complete, 5 still not". */
export function syncedSaid(wanted: string[], still: Verdict[]): string {
  const left = new Set(still.map((c) => c.name))
  const fixed = wanted.filter((n) => !left.has(n)).length
  const rest = wanted.length - fixed
  return `Synced ${wanted.length}: ${fixed} now complete${rest ? `, ${rest} still not` : ""}`
}

/**
 * What a row says while the gate syncs, or while a sync in flight it will
 * join runs: a spinner for its own sync, "syncing, started 2 min ago" for
 * another's, then "queued" or "synced"; nothing when neither applies.
 */
export function rowProgress(
  c: Verdict,
  at: { own: boolean; scraping: boolean; seen: boolean; now: number },
): { spin: boolean; text: string } | null {
  if (at.scraping) return { spin: true, text: "" }
  if (c.syncingSince != null)
    return {
      spin: true,
      text: `syncing, started ${span(at.now - c.syncingSince)} ago${c.syncAgain ? ", another to follow" : ""}`,
    }
  if (!at.own) return null
  return { spin: false, text: at.seen ? "synced" : "queued" }
}

/** The Channels each choice names in the record. */
export type OutcomeNames = { timedOut?: string[]; leftOut?: string[] }

/**
 * What the record says each choice did to the Channels a sync could fix;
 * `prior` is what Leave out already took out.
 */
export function outcomeOf(
  choice: GateChoice,
  frozenAt: number,
  check: WindowCheck | undefined,
  named: OutcomeNames = {},
  prior: string[] = [],
): GateOutcome {
  return {
    choice,
    frozenAt,
    skipped: choice === "skipped" ? fixableNames(check) : [],
    timedOut: named.timedOut ?? [],
    leftOut: [...prior, ...(named.leftOut ?? [])],
  }
}

/** How the gate's wait ended, every sync done, "Continue now" or the deadline. */
export type WaitEnd = "synced" | "continued" | "deadline"

/**
 * The choice the wait records, and the Channels it times out, only those a
 * sync was still syncing when it ended. One whose sync finished keeps its
 * real reason, Incomplete or not.
 */
export function afterWait(end: WaitEnd, wanted: string[], again: WindowCheck) {
  const waited = new Set(wanted)
  const timedOut =
    end === "synced"
      ? []
      : incompleteOf(again)
          .filter((c) => waited.has(c.name) && c.syncingSince != null)
          .map((c) => c.name)
  const choice: GateChoice =
    end === "synced"
      ? "synced"
      : end === "deadline"
        ? "timed_out"
        : "continued_early"
  return { choice, timedOut }
}
