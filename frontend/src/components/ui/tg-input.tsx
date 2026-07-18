import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"

import { cn } from "@/lib/utils"

const tgInputVariants = cva(
  "w-full transition-all focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40",
  {
    variants: {
      variant: {
        settings:
          "bg-app-ink/5 border border-app-ink/10 p-3 text-[10px] font-mono uppercase tracking-widest focus:border-app-ink/30 focus-visible:ring-2 focus-visible:ring-app-ink/30",
        muted:
          "bg-app-muted/50 border border-app-ink/10 rounded-lg py-2 px-3 text-sm focus:ring-2 focus:ring-app-ink/20 focus-visible:ring-2 focus-visible:ring-app-ink/30",
      },
    },
    defaultVariants: {
      variant: "settings",
    },
  },
)

/** Shared class for native `<select>` matching TgInput settings fields. */
const tgFieldClassName = tgInputVariants({ variant: "settings" })

type TgInputProps = Omit<React.ComponentProps<"input">, "size"> &
  VariantProps<typeof tgInputVariants>

const TgInput = React.forwardRef<HTMLInputElement, TgInputProps>(
  ({ className, variant = "settings", type = "text", ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        data-slot="tg-input"
        data-variant={variant ?? "settings"}
        className={cn(tgInputVariants({ variant }), className)}
        {...props}
      />
    )
  },
)
TgInput.displayName = "TgInput"

type TgTextareaProps = React.ComponentProps<"textarea"> &
  VariantProps<typeof tgInputVariants>

const TgTextarea = React.forwardRef<HTMLTextAreaElement, TgTextareaProps>(
  ({ className, variant = "settings", ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        data-slot="tg-textarea"
        data-variant={variant ?? "settings"}
        className={cn(tgInputVariants({ variant }), className)}
        {...props}
      />
    )
  },
)
TgTextarea.displayName = "TgTextarea"

type TgFieldLabelProps = React.ComponentProps<"label"> & {
  htmlFor?: string
}

function TgFieldLabel({ className, ...props }: TgFieldLabelProps) {
  return (
    <label
      data-slot="tg-field-label"
      className={cn(
        "block text-[10px] font-mono uppercase tracking-widest opacity-60 mb-1.5",
        className,
      )}
      {...props}
    />
  )
}

export {
  TgInput,
  TgTextarea,
  TgFieldLabel,
  tgInputVariants,
  tgFieldClassName,
}
export type { TgInputProps, TgTextareaProps, TgFieldLabelProps }
