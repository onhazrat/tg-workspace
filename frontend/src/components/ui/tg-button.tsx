import { cva, type VariantProps } from "class-variance-authority"
import { Loader2 } from "lucide-react"
import * as React from "react"

import { cn } from "@/lib/utils"

const tgButtonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-bold uppercase transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ink/30 disabled:pointer-events-none disabled:opacity-30 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-app-ink text-app-bg shadow-sm hover:opacity-90 focus-visible:ring-app-ink/30",
        secondary:
          "border border-app-ink/20 bg-transparent text-app-ink hover:bg-app-ink/5",
        ghost:
          "bg-transparent text-app-ink/70 hover:bg-app-ink/5 hover:text-app-ink",
        danger:
          "bg-red-500 text-white shadow-lg shadow-red-500/20 hover:bg-red-600 focus-visible:ring-red-500/40",
        dangerSoft:
          "border border-red-500/30 bg-red-500/10 text-red-600 hover:bg-red-500/20 focus-visible:ring-red-500/40",
        successSoft:
          "border border-green-600/40 bg-green-500/10 text-app-ink hover:bg-green-500/20 focus-visible:ring-green-500/40",
        infoSoft:
          "bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 focus-visible:ring-blue-500/40",
        link: "bg-transparent text-app-ink/70 hover:bg-transparent hover:underline focus-visible:ring-app-ink/30",
      },
      size: {
        sm: "h-8 rounded-md px-3 text-[10px] tracking-widest",
        md: "rounded-md px-3 py-2 text-xs tracking-widest",
        lg: "rounded-md px-4 py-3 text-[10px] tracking-widest",
      },
    },
    compoundVariants: [
      {
        variant: "link",
        class: "h-auto rounded-none px-0 py-0",
      },
    ],
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
)

type TgButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof tgButtonVariants> & {
    loading?: boolean
    loadingLabel?: string
  }

const TgButton = React.forwardRef<HTMLButtonElement, TgButtonProps>(
  (
    {
      className,
      variant,
      size,
      loading = false,
      loadingLabel,
      disabled,
      children,
      type = "button",
      ...props
    },
    ref,
  ) => {
    const isDisabled = Boolean(disabled || loading)
    return (
      <button
        ref={ref}
        type={type}
        data-slot="tg-button"
        data-variant={variant ?? "primary"}
        className={cn(tgButtonVariants({ variant, size }), className)}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
        {loading && loadingLabel ? loadingLabel : children}
      </button>
    )
  },
)
TgButton.displayName = "TgButton"

export { TgButton, tgButtonVariants }
export type { TgButtonProps }
