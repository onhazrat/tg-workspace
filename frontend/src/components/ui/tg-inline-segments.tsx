import type * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Quiet sentence-case segments on a tinted track, the Directory search's
 * "Name / Bio / Posts" switch. Each segment is a pressed / unpressed button,
 * so the same pieces make a single choice (the caller presses one) or a
 * multi-select (the caller presses several).
 *
 * Not `TgSegmentedControl`, which is the older uppercase look.
 */
function TgInlineSegments({
  className,
  ...props
}: React.ComponentProps<"fieldset">) {
  return (
    <fieldset
      data-slot="tg-inline-segments"
      className={cn(
        "flex items-center gap-0.5 rounded-lg bg-app-ink/5 p-0.5 text-[11px]",
        className,
      )}
      {...props}
    />
  )
}

function TgInlineSegment({
  pressed,
  className,
  type = "button",
  ...props
}: React.ComponentProps<"button"> & { pressed: boolean }) {
  return (
    <button
      type={type}
      aria-pressed={pressed}
      className={cn(
        "rounded-md px-2 py-1",
        pressed
          ? "bg-app-card font-semibold shadow-sm"
          : "text-app-ink/50 hover:text-app-ink",
        className,
      )}
      {...props}
    />
  )
}

export { TgInlineSegment, TgInlineSegments }
