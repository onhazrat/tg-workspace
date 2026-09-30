// PROTOTYPE, throwaway: a styled popover shared by the variants.
import { Popover } from "radix-ui"
import type React from "react"
import { cn } from "@/lib/utils"

export const Pop: React.FC<{
  trigger: React.ReactNode
  children: React.ReactNode
  className?: string
  align?: "start" | "center" | "end"
  open?: boolean
  onOpenChange?: (open: boolean) => void
}> = ({
  trigger,
  children,
  className,
  align = "start",
  open,
  onOpenChange,
}) => (
  <Popover.Root open={open} onOpenChange={onOpenChange}>
    <Popover.Trigger asChild>{trigger}</Popover.Trigger>
    <Popover.Portal>
      <Popover.Content
        align={align}
        sideOffset={6}
        className={cn(
          "z-50 max-h-[70vh] overflow-y-auto rounded-lg border border-app-ink/15 bg-app-card p-2 text-app-ink shadow-xl",
          className,
        )}
      >
        {children}
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
)

export const PopLabel: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <div className="px-2 pb-1 pt-2 text-[9px] font-bold uppercase tracking-widest text-app-ink/45">
    {children}
  </div>
)

/** A menu-like row with a leading tri-state box. */
export const CheckRow: React.FC<{
  state: "selected" | "partial" | "idle"
  onClick: () => void
  children: React.ReactNode
  trailing?: React.ReactNode
  title?: string
}> = ({ state, onClick, children, trailing, title }) => (
  <div className="group flex items-center gap-1 rounded-md hover:bg-app-ink/5">
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-[11px] font-semibold"
    >
      <span
        className={cn(
          "grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[3px] border text-[9px] leading-none",
          state === "selected" && "border-app-ink bg-app-ink text-app-bg",
          state === "partial" && "border-app-ink/60 bg-app-ink/20",
          state === "idle" && "border-app-ink/30",
        )}
      >
        {state === "selected" ? "✓" : state === "partial" ? "–" : ""}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
    {trailing}
  </div>
)

export const Check: React.FC<{
  checked: boolean
  onChange: (value: boolean) => void
  children: React.ReactNode
  testId?: string
}> = ({ checked, onChange, children, testId }) => (
  <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[11px] font-semibold hover:bg-app-ink/5">
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      data-testid={testId}
      className="h-3.5 w-3.5 accent-app-ink"
    />
    {children}
  </label>
)
