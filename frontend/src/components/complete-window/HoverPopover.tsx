import { useState } from "react"

import { BarPopover } from "@/components/BarPopover"

/**
 * A button whose popover a mouse opens on hover and a tap or a key opens on
 * click, kept on screen, for History's pill and a failed row's error (stories
 * 39, 48).
 */
export function HoverPopover({
  trigger,
  className,
  testId,
  children,
}: {
  trigger: React.ReactNode
  className: string
  testId?: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <BarPopover
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button
          type="button"
          data-testid={testId}
          onPointerEnter={(e) => e.pointerType === "mouse" && setOpen(true)}
          onPointerLeave={(e) => e.pointerType === "mouse" && setOpen(false)}
          // A mouse already opened it on hover; its click must not close it.
          onClick={(e) =>
            (e.nativeEvent as PointerEvent).pointerType === "mouse" &&
            e.preventDefault()
          }
          className={className}
        >
          {trigger}
        </button>
      }
    >
      {children}
    </BarPopover>
  )
}
