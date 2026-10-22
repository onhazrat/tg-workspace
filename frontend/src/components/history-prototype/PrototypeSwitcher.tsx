// PROTOTYPE: floating variant switcher for throwaway UI prototypes. Never merge.
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useEffect } from "react"

export function PrototypeSwitcher({
  variants,
  current,
  onChange,
}: {
  variants: { key: string; name: string }[]
  current: string
  onChange: (key: string) => void
}) {
  const index = Math.max(
    0,
    variants.findIndex((v) => v.key === current),
  )
  const step = (by: number) =>
    onChange(variants[(index + by + variants.length) % variants.length].key)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (
        el?.closest("input, textarea, select, [contenteditable='true']") ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey
      )
        return
      if (e.key === "ArrowLeft") step(-1)
      if (e.key === "ArrowRight") step(1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  if (!import.meta.env.DEV) return null
  const v = variants[index]
  return (
    <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border-2 border-fuchsia-500 bg-black px-2 py-1 font-mono text-xs text-white shadow-2xl">
      <button
        type="button"
        aria-label="Previous variant"
        onClick={() => step(-1)}
        className="rounded-full p-1 hover:bg-white/20"
      >
        <ChevronLeft size={16} />
      </button>
      <span className="min-w-48 text-center">
        <span className="text-fuchsia-400">PROTOTYPE</span> {v.key} ({v.name}) ·{" "}
        {index + 1}/{variants.length}
      </span>
      <button
        type="button"
        aria-label="Next variant"
        onClick={() => step(1)}
        className="rounded-full p-1 hover:bg-white/20"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  )
}
