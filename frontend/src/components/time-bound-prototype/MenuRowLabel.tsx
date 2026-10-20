/**
 * PROTOTYPE (time-bound): a Filters menu row's name with its symbol, as the
 * Directory's condition menu draws one. Throwaway: fold the winner in.
 */
import type { LucideIcon } from "lucide-react"

export function MenuRowLabel({
  icon: Icon,
  label,
}: {
  icon: LucideIcon
  label: string
}) {
  return (
    <span className="flex items-center gap-2">
      <Icon size={11} aria-hidden />
      {label}
    </span>
  )
}
