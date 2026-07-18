import { cva, type VariantProps } from "class-variance-authority"
import { Loader2 } from "lucide-react"
import * as React from "react"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tg-tooltip"
import { cn } from "@/lib/utils"

const tgIconButtonVariants = cva(
  "inline-flex items-center justify-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ink/30 disabled:pointer-events-none disabled:opacity-20 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        ghost:
          "p-1.5 rounded-md text-app-ink/50 hover:text-app-ink hover:bg-app-ink/5",
        frosted:
          "w-8 h-8 rounded-full bg-app-bg/90 text-app-ink/70 hover:text-app-ink hover:bg-app-bg shadow-sm backdrop-blur-sm",
        danger:
          "p-1.5 rounded-md text-red-500/70 hover:text-red-500 hover:bg-red-500/10",
        soft: "p-1.5 text-app-ink opacity-30 hover:opacity-100 border border-app-ink/10 hover:bg-app-ink/5",
      },
    },
    defaultVariants: {
      variant: "ghost",
    },
  },
)

type TgIconButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof tgIconButtonVariants> & {
    loading?: boolean
    tooltip?: React.ReactNode
    "aria-label": string
  }

const TgIconButton = React.forwardRef<HTMLButtonElement, TgIconButtonProps>(
  (
    {
      className,
      variant = "ghost",
      loading = false,
      disabled,
      tooltip,
      children,
      type = "button",
      ...props
    },
    ref,
  ) => {
    const isDisabled = Boolean(disabled || loading)
    const button = (
      <button
        ref={ref}
        type={type}
        data-slot="tg-icon-button"
        data-variant={variant ?? "ghost"}
        className={cn(tgIconButtonVariants({ variant }), className)}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : children}
      </button>
    )

    if (tooltip == null || tooltip === false) return button

    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>
          {typeof tooltip === "string" || typeof tooltip === "number" ? (
            <p>{tooltip}</p>
          ) : (
            tooltip
          )}
        </TooltipContent>
      </Tooltip>
    )
  },
)
TgIconButton.displayName = "TgIconButton"

export { TgIconButton, tgIconButtonVariants }
export type { TgIconButtonProps }
