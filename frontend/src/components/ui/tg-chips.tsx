import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"

import { cn } from "@/lib/utils"

const tgSelectionChipVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ink/30",
  {
    variants: {
      state: {
        selected: "bg-app-ink text-app-bg border-app-ink",
        partial: "bg-app-ink/20 text-app-ink border-app-ink/40",
        idle: "bg-app-muted text-app-ink border-app-ink/10 hover:border-app-ink/30 hover:bg-app-ink/5",
      },
    },
    defaultVariants: {
      state: "idle",
    },
  },
)

type TgSelectionChipProps = React.ComponentProps<"button"> &
  VariantProps<typeof tgSelectionChipVariants>

function TgSelectionChip({
  className,
  state = "idle",
  type = "button",
  ...props
}: TgSelectionChipProps) {
  return (
    <button
      type={type}
      data-slot="tg-selection-chip"
      data-state={state ?? "idle"}
      className={cn(tgSelectionChipVariants({ state }), className)}
      {...props}
    />
  )
}

const tgMetaChipVariants = cva(
  "inline-flex items-center gap-1 rounded-full bg-app-muted/30 text-app-ink/70",
  {
    variants: {
      size: {
        card: "px-2 py-0.5 text-[10px] font-bold",
        history:
          "px-2 py-1 rounded-md text-[11px] font-mono uppercase tracking-widest",
      },
    },
    defaultVariants: {
      size: "card",
    },
  },
)

type TgMetaChipProps = React.ComponentProps<"span"> &
  VariantProps<typeof tgMetaChipVariants>

function TgMetaChip({
  className,
  size = "card",
  ...props
}: TgMetaChipProps) {
  return (
    <span
      data-slot="tg-meta-chip"
      data-size={size ?? "card"}
      className={cn(tgMetaChipVariants({ size }), className)}
      {...props}
    />
  )
}

const tgFilterChipVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ink/30",
  {
    variants: {
      selected: {
        true: "bg-app-ink text-app-bg border-app-ink",
        false:
          "bg-app-muted border-app-ink/10 hover:border-app-ink/30 hover:bg-app-ink/5 text-app-ink",
      },
    },
    defaultVariants: {
      selected: false,
    },
  },
)

type TgFilterChipProps = React.ComponentProps<"button"> &
  VariantProps<typeof tgFilterChipVariants>

function TgFilterChip({
  className,
  selected = false,
  type = "button",
  ...props
}: TgFilterChipProps) {
  return (
    <button
      type={type}
      data-slot="tg-filter-chip"
      data-selected={selected ? "true" : "false"}
      className={cn(tgFilterChipVariants({ selected }), className)}
      aria-pressed={Boolean(selected)}
      {...props}
    />
  )
}

export {
  TgSelectionChip,
  TgMetaChip,
  TgFilterChip,
  tgSelectionChipVariants,
  tgMetaChipVariants,
  tgFilterChipVariants,
}
export type { TgSelectionChipProps, TgMetaChipProps, TgFilterChipProps }
