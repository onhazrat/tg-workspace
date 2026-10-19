import type * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Quiet sentence-case segments on a tinted track, the Directory search's
 * "Name / Bio / Posts" switch. Each segment is a pressed / unpressed button,
 * so the same pieces make a single choice (the caller presses one) or a
 * multi-select (the caller presses several).
 *
 * `TgInlineChoice` below is the single-choice form. `TgSegmentedControl` is
 * the older uppercase look, left only on the Settings sections SET-02 replaces.
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

type TgInlineChoiceOption<T extends string> = {
  value: T
  label: React.ReactNode
  disabled?: boolean
  "data-testid"?: string
}

/** The segments as one choice among a few: a mode switch, an enum setting. */
function TgInlineChoice<T extends string>({
  options,
  value,
  onChange,
  className,
  "aria-label": ariaLabel,
}: {
  options: TgInlineChoiceOption<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
  "aria-label": string
}) {
  return (
    <TgInlineSegments
      aria-label={ariaLabel}
      className={cn("inline-flex", className)}
    >
      {options.map((option) => (
        <TgInlineSegment
          key={option.value}
          pressed={option.value === value}
          disabled={option.disabled}
          data-testid={option["data-testid"]}
          onClick={() => onChange(option.value)}
          className="disabled:opacity-30"
        >
          {option.label}
        </TgInlineSegment>
      ))}
    </TgInlineSegments>
  )
}

export { TgInlineChoice, TgInlineSegment, TgInlineSegments }
export type { TgInlineChoiceOption }
