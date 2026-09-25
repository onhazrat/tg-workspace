import { CreditCard, Eye, Pencil } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { ViewAsClaims } from "@/lib/storage/scoped"

/**
 * What `ViewAsRibbon` renders, as props only. The shell keeps the session, the
 * expiry clock and the exchanges; this decides nothing but what each tier
 * looks like. `ViewAsRibbon.tsx` explains why each tier looks the way it does.
 */

/**
 * The lifetimes offered for an elevation (ticket 27).
 *
 * A short menu rather than a number field: the server bounds the value anyway,
 * and a free-text minute count invites the Owner to type the maximum every
 * time — which is exactly what "chosen per elevation" is meant to stop. The
 * options are the three shapes the work actually takes, and the first is the
 * default because most of them are the first.
 *
 * Kept at or below `VIEW_AS_ELEVATED_MAX_MINUTES` (15); the server answers 422
 * for anything above it, so a drift here is a visible refusal rather than a
 * silently longer session.
 */
export const ELEVATION_MINUTES = [5, 10, 15] as const

/**
 * The lifetimes offered for a spend session (BYOK-04).
 *
 * Shorter than the elevation menu because the ceiling is shorter — the server
 * validates `VIEW_AS_SPEND_MAX_MINUTES` (10) to be strictly under the elevated
 * one, so anything above it is a 422 rather than a longer session.
 */
export const SPEND_MINUTES = [3, 5, 10] as const

/** Read-only, allowed to write, or allowed to spend. */
export type RibbonTier = "read" | "elevated" | "spend"

/** Spend wins: it is the wider tier and the one that costs money. */
export function ribbonTier(
  isSpending: boolean,
  isElevated: boolean,
): RibbonTier {
  if (isSpending) return "spend"
  return isElevated ? "elevated" : "read"
}

/**
 * When a session that can write runs out, in milliseconds, or null for a
 * read-only session (which falls back to the Owner's token silently, because
 * nothing can be written).
 */
export function writableUntilMs(
  claims: ViewAsClaims | null,
  isWriting: boolean,
): number | null {
  return isWriting && claims ? claims.expiresAt * 1000 : null
}

const TIER_BACKGROUND: Record<RibbonTier, string> = {
  spend: "bg-rose-700",
  elevated: "bg-amber-600",
  read: "bg-destructive",
}

const TIER_ICON: Record<RibbonTier, typeof Eye> = {
  spend: CreditCard,
  elevated: Pencil,
  read: Eye,
}

function RibbonMessage({
  tier,
  claims,
}: {
  tier: RibbonTier
  claims: ViewAsClaims
}) {
  if (tier === "spend") {
    return (
      <>
        <strong>Spending as {claims.subjectEmail}</strong> — their AI key, bots
        and Telegram budget pay for what you do, and every call is recorded as
        yours. Signed in as {claims.actorEmail}.
      </>
    )
  }
  if (tier === "elevated") {
    return (
      <>
        <strong>Acting as {claims.subjectEmail}</strong> — changes are saved to
        their account and recorded as yours. Signed in as {claims.actorEmail}.
      </>
    )
  }
  return (
    <>
      Viewing as <strong>{claims.subjectEmail}</strong> — read-only. Signed in
      as {claims.actorEmail}.
    </>
  )
}

export function ViewAsRibbonBar({
  claims,
  tier,
  widening,
  onElevate,
  onSpend,
  onExit,
}: {
  claims: ViewAsClaims
  tier: RibbonTier
  widening: boolean
  onElevate: (minutes: number) => void
  onSpend: (minutes: number) => void
  onExit: () => void
}) {
  const Icon = TIER_ICON[tier]
  return (
    <div
      data-testid="view-as-ribbon"
      data-view-as-mode={claims.mode}
      className={`sticky top-0 z-50 flex h-10 shrink-0 items-center justify-center gap-3 px-4 text-sm font-medium text-white shadow-md ${TIER_BACKGROUND[tier]}`}
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate">
        <RibbonMessage tier={tier} claims={claims} />
      </span>

      {tier === "read" &&
        ELEVATION_MINUTES.map((minutes) => (
          <Button
            key={minutes}
            size="sm"
            variant="secondary"
            className="h-7 shrink-0"
            disabled={widening}
            onClick={() => onElevate(minutes)}
            title={`Make changes on their behalf for ${minutes} minutes`}
          >
            {minutes === ELEVATION_MINUTES[0]
              ? `Make a change (${minutes}m)`
              : `${minutes}m`}
          </Button>
        ))}

      {/*
       * Offered from *either* lower tier, unlike elevation. A spend session is
       * wider than an elevated one, so an Owner who elevated and then hit the
       * AI refusal reaches it without exiting and starting over — which is the
       * moment they would otherwise be told to elevate again by the only string
       * the server had before BYOK-04.
       *
       * **Every label says "Spend", and the variant differs.** The first cut
       * used the elevation menu's shape — a named first button and bare `5m` /
       * `10m` after it — which put two buttons reading `5m` and two reading
       * `10m` in one ribbon, identically styled, one minute apart in what they
       * grant. An Owner reaching for a ten-minute elevation could start
       * spending somebody's money, and nothing confirms the click.
       */}
      {tier !== "spend" &&
        SPEND_MINUTES.map((minutes) => (
          <Button
            key={`spend-${minutes}`}
            size="sm"
            variant="destructive"
            className="h-7 shrink-0 border border-white/40"
            disabled={widening}
            onClick={() => onSpend(minutes)}
            title={`Spend their AI key, bots and Telegram budget for ${minutes} minutes`}
          >
            {`Spend ${minutes}m`}
          </Button>
        ))}

      <Button
        size="sm"
        variant="secondary"
        className="h-7 shrink-0"
        onClick={onExit}
      >
        Exit
      </Button>
    </div>
  )
}
