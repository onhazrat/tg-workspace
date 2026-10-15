import { Timer, X } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { TgButton } from "@/components/ui/tg-button"

/**
 * The automatic retry waiting on the worker (SFR-03): the seconds left and
 * Cancel, which withdraws it. When it falls due, `children` (the running
 * Attempt) takes its place.
 */
export function RetryCountdown({
  startsAt,
  onCancel,
  children,
}: {
  startsAt: number
  onCancel: () => void
  children: ReactNode
}) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const seconds = Math.ceil((startsAt - now) / 1000)
  if (seconds <= 0) return children
  return (
    <section
      data-testid="retry-countdown"
      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-app-ink/10 p-4 md:p-6"
    >
      <div className="flex min-w-0 items-center gap-2">
        <Timer size={14} className="shrink-0" />
        <p className="text-sm">
          The provider was busy. Retrying automatically in {seconds}s.
        </p>
      </div>
      <TgButton type="button" variant="secondary" onClick={onCancel}>
        <X size={12} />
        Cancel
      </TgButton>
    </section>
  )
}
