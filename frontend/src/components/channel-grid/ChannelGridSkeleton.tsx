import { useRef } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import type { CardFace, CardZoom } from "@/lib/channels/card-zoom"
import { gridLanesForWidth } from "@/lib/channels/grid-lanes"
import { useGridBox } from "./useGridBox"

/** Each Card size's name on its placeholders, and how many rows fill a screen. */
const SIZES: Record<CardZoom, { name: string; rows: number }> = {
  [-2]: { name: "tiles", rows: 6 },
  [-1]: { name: "compact", rows: 4 },
  0: { name: "cards", rows: 2 },
  1: { name: "detailed", rows: 2 },
}

const FRAME = "rounded-2xl border border-app-ink/10 bg-app-card"

const bar = (className: string, part?: string, key?: number) => (
  <Skeleton
    key={key}
    data-skeleton-part={part}
    className={`bg-app-ink/10 ${className}`}
  />
)

/** The photo, title and handle every card but a tile starts with. */
const header = (
  <div className="mb-4 flex items-start gap-4">
    {bar("size-14 shrink-0 rounded-full", "header")}
    <div className="flex-1 space-y-2 pt-1">
      {bar("h-4 w-3/4")}
      {bar("h-3 w-1/2")}
    </div>
  </div>
)

/** A placeholder in the shape of the card `face` will draw. */
function Placeholder({ face, name }: { face: CardFace; name: string }) {
  if (face.layout === "tile")
    return (
      <div
        data-card-size={name}
        className={`${FRAME} flex aspect-square items-center justify-center p-2`}
      >
        {bar("size-12 rounded-full")}
      </div>
    )
  if (face.bodySelects)
    return (
      <div data-card-size={name} className={`${FRAME} flex flex-col p-4 pt-9`}>
        {header}
        <div className="mt-auto flex items-end justify-between gap-3">
          <div className="space-y-1.5">
            {bar("h-3 w-16")}
            {bar("h-2 w-24")}
          </div>
          {bar("h-8 w-20 rounded-lg")}
        </div>
      </div>
    )
  return (
    <div data-card-size={name} className={`${FRAME} flex flex-col p-5 pt-12`}>
      {header}
      {face.bio && (
        <div className="mb-4 space-y-1.5">
          {bar("h-3 w-full", "bio")}
          {bar(`h-3 ${face.detailed ? "w-full" : "w-2/3"}`, "bio")}
          {face.detailed && bar("h-3 w-[90%]", "bio")}
          {face.detailed && bar("h-3 w-1/2", "bio")}
        </div>
      )}
      <div className="mb-4 grid grid-cols-3 gap-1.5">
        {face.statTiles.map((_, i) => bar("h-12 rounded-lg", "stat", i))}
      </div>
      <div className="mb-5 flex flex-wrap gap-1.5">
        {bar("h-6 w-16 rounded-md", "tag")}
        {bar("h-6 w-20 rounded-md")}
      </div>
      {face.detailed && bar("mb-4 h-2.5 w-2/3", "about")}
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-app-ink/5 pt-4">
        <div className="flex items-start gap-4">
          {face.startId && (
            <div className="space-y-1.5">
              {bar("h-2.5 w-14", "start-id")}
              {bar("h-4 w-8")}
            </div>
          )}
          {/* Status, the sync line, one schedule line or the detailed two,
              and the last post, as the real footer stacks them. */}
          <div className="space-y-1.5">
            {bar("h-2.5 w-16")}
            {bar("h-4 w-24")}
            {bar("h-2.5 w-24")}
            {face.detailed && bar("h-2.5 w-24")}
            {bar("h-2.5 w-20")}
          </div>
        </div>
        {bar("h-8 w-20 rounded-lg")}
      </div>
    </div>
  )
}

/**
 * The first load's placeholders, in the shape, columns and rough count of the
 * cards that will load at this Card size (CSK-01), as the Posts tab's are.
 */
export function ChannelGridSkeleton({
  zoom,
  face,
}: {
  zoom: CardZoom
  face: CardFace
}) {
  const ref = useRef<HTMLDivElement>(null)
  const lanes = gridLanesForWidth(useGridBox(ref).width, zoom)
  const { name, rows } = SIZES[zoom]
  return (
    <div
      ref={ref}
      id="tour-channel-grid"
      className="grid gap-4"
      style={{ gridTemplateColumns: `repeat(${lanes}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: lanes * rows }, (_, i) => (
        <Placeholder key={`channel-skeleton-${i}`} face={face} name={name} />
      ))}
    </div>
  )
}
