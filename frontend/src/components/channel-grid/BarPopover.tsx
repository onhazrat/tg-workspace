import { Popover } from "radix-ui"
import type React from "react"

/**
 * The popover every Channels bar control opens. The trigger is passed as an
 * element and Radix clones its props onto it, so it must be a DOM element or
 * a component that forwards its props and ref, or it never opens.
 */
export function BarPopover({
  trigger,
  children,
  align = "start",
  width = "w-72",
}: {
  trigger: React.ReactElement
  children: React.ReactNode
  align?: "start" | "center" | "end"
  width?: string
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align={align}
          sideOffset={6}
          className={`z-50 ${width} max-h-[70vh] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-app-ink/10 bg-app-card p-2 text-xs text-app-ink shadow-xl`}
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

export const BarHeading = ({ children }: { children: React.ReactNode }) => (
  <div className="px-2 pb-1 pt-2 text-[11px] font-semibold text-app-ink/60">
    {children}
  </div>
)

/** The search box at the top of a dropdown. */
export function BarSearch({
  value,
  onChange,
  placeholder,
  testId,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  testId?: string
}) {
  return (
    <input
      // biome-ignore lint/a11y/noAutofocus: the dropdown opens to search it.
      autoFocus
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      data-testid={testId}
      className="mb-1 h-8 w-full rounded-lg border border-app-ink/15 bg-app-muted px-2.5 text-xs outline-none focus:border-app-ink/40"
    />
  )
}
