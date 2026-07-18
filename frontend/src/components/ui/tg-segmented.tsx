import { cva, type VariantProps } from "class-variance-authority"
import type * as React from "react"

import { cn } from "@/lib/utils"

const tgSegmentedTrackVariants = cva(
  "inline-flex bg-app-ink/5 p-1 rounded-lg border border-app-ink/10",
  {
    variants: {
      size: {
        sm: "gap-0.5",
        md: "gap-1",
      },
    },
    defaultVariants: {
      size: "md",
    },
  },
)

const tgSegmentedOptionVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-md font-bold uppercase tracking-widest transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ink/30 disabled:opacity-30",
  {
    variants: {
      size: {
        sm: "px-2.5 py-1 text-[9px]",
        md: "px-3 py-1.5 text-[10px]",
      },
      selected: {
        true: "bg-app-ink text-app-bg shadow-sm",
        false: "text-app-ink/60 hover:text-app-ink hover:bg-app-ink/5",
      },
    },
    defaultVariants: {
      size: "md",
      selected: false,
    },
  },
)

type TgSegmentedOption<T extends string> = {
  value: T
  label: React.ReactNode
  disabled?: boolean
}

type TgSegmentedControlProps<T extends string> = {
  options: TgSegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  size?: VariantProps<typeof tgSegmentedTrackVariants>["size"]
  className?: string
  optionClassName?: string
  "aria-label"?: string
}

function TgSegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  className,
  optionClassName,
  "aria-label": ariaLabel,
}: TgSegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-slot="tg-segmented-control"
      className={cn(tgSegmentedTrackVariants({ size }), className)}
    >
      {options.map((option) => {
        const isSelected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            disabled={option.disabled}
            aria-pressed={isSelected}
            data-selected={isSelected ? "true" : "false"}
            className={cn(
              tgSegmentedOptionVariants({ size, selected: isSelected }),
              optionClassName,
            )}
            onClick={() => {
              if (!isSelected) onChange(option.value)
            }}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

type TgHeroEmptyStateProps = {
  icon?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  children?: React.ReactNode
  className?: string
}

function TgHeroEmptyState({
  icon,
  title,
  description,
  children,
  className,
}: TgHeroEmptyStateProps) {
  return (
    <div
      data-slot="tg-hero-empty-state"
      className={cn(
        "flex flex-col items-center justify-center text-center py-16 px-6",
        className,
      )}
    >
      {icon ? (
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-app-ink/10 bg-app-muted/40 text-app-ink/50">
          {icon}
        </div>
      ) : null}
      <h3 className="text-base font-bold tracking-tight text-app-ink mb-2">
        {title}
      </h3>
      {description ? (
        <p className="max-w-sm text-sm text-app-ink/60 mb-4">{description}</p>
      ) : null}
      {children}
    </div>
  )
}

export {
  TgSegmentedControl,
  TgHeroEmptyState,
  tgSegmentedTrackVariants,
  tgSegmentedOptionVariants,
}
export type {
  TgSegmentedControlProps,
  TgSegmentedOption,
  TgHeroEmptyStateProps,
}
