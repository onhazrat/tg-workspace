import type React from "react"
import {
  DISCOVERY_MEDIA_MIX_KINDS,
  type DiscoveryMediaMix,
  type DiscoveryMediaMixKind,
} from "@/lib/posts/discover-candidates"

/**
 * What a Channel publishes, as a shape rather than four numbers.
 *
 * The mix earns a column because it reads at a glance and costs no reading
 * effort: a photo Channel and a link-dump Channel are different bars before you
 * have parsed a single figure. Four percentages in four cells would be the same
 * information and nobody would scan it.
 *
 * **Not a percentage of the Post count**, and the tooltip says so. Those
 * counters come from Telegram's channel info bar and count media *items*, so an
 * album of five photos adds five and a Post carrying a photo and a link counts
 * in both. This is each counter against the other three, which needs no
 * denominator and is therefore honest.
 *
 * Colours come from the palette rather than raw hex, so both themes get a
 * readable bar from one declaration. `dark:` variants would be a second set of
 * four colours to keep in step with the first.
 */
const SEGMENTS: Record<
  DiscoveryMediaMixKind,
  { label: string; className: string }
> = {
  photos: { label: "Photos", className: "bg-blue-500" },
  videos: { label: "Videos", className: "bg-violet-500" },
  files: { label: "Files", className: "bg-amber-500" },
  links: { label: "Links", className: "bg-emerald-500" },
}

/**
 * Deliberately no density.
 *
 * The spec puts forward share, script, density and the sample Post bodies in
 * the **panel**, not on the row: ten numbers is not a scannable row. Density is
 * ticket 03's to render, and it is already on the wire, derived at read — so
 * that ticket is a consumer of this one rather than a schema change.
 */
interface DiscoverMediaMixBarProps {
  mix: DiscoveryMediaMix | null | undefined
  handle: string
}

export const DiscoverMediaMixBar: React.FC<DiscoverMediaMixBarProps> = ({
  mix,
  handle,
}) => {
  if (!mix) return null

  const present = DISCOVERY_MEDIA_MIX_KINDS.filter(
    (kind): kind is DiscoveryMediaMixKind => (mix[kind] ?? 0) > 0,
  )
  if (present.length === 0) return null

  const parts = present
    .map(
      (kind) =>
        `${SEGMENTS[kind].label} ${Math.round((mix[kind] ?? 0) * 100)}%`,
    )
    .join(" · ")
  const title =
    `${parts}. Shares of each other, not of the Post count — Telegram counts ` +
    `media items, so an album adds one per photo.`

  return (
    <div
      className="flex h-2 w-20 overflow-hidden rounded-full bg-app-muted/40"
      data-testid={`discover-media-mix-${handle}`}
      title={title}
      // The bar is decoration over a number the tooltip states; a screen reader
      // gets the sentence rather than four unlabelled boxes.
      role="img"
      aria-label={parts}
    >
      {present.map((kind) => (
        <div
          key={kind}
          className={SEGMENTS[kind].className}
          style={{ width: `${(mix[kind] ?? 0) * 100}%` }}
        />
      ))}
    </div>
  )
}
