// PROTOTYPE, throwaway: floating bar that cycles `?variant=`. Dev builds only.
import { ChevronLeft, ChevronRight } from "lucide-react"
import type React from "react"
import { useEffect } from "react"

type Props = {
  variants: { key: string; name: string }[]
  current: string
  onChange: (key: string) => void
}

export const PrototypeSwitcher: React.FC<Props> = ({
  variants,
  current,
  onChange,
}) => {
  const index = Math.max(
    0,
    variants.findIndex((v) => v.key === current),
  )
  const step = (by: number) =>
    onChange(variants[(index + by + variants.length) % variants.length].key)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t?.closest("input, textarea, select, [contenteditable]")) return
      if (e.key === "ArrowLeft") step(-1)
      if (e.key === "ArrowRight") step(1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  if (!import.meta.env.DEV) return null
  const v = variants[index]
  return (
    <div className="fixed bottom-5 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-1 rounded-full bg-fuchsia-600 px-1.5 py-1.5 text-white shadow-2xl ring-4 ring-fuchsia-600/25">
      <button
        type="button"
        onClick={() => step(-1)}
        className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/20"
        aria-label="Previous variant"
      >
        <ChevronLeft size={16} />
      </button>
      <span className="min-w-52 px-2 text-center text-[12px] font-bold">
        {v.key} ({v.name})
        <span className="ml-2 font-normal opacity-70">
          {index + 1}/{variants.length}
        </span>
      </span>
      <button
        type="button"
        onClick={() => step(1)}
        className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/20"
        aria-label="Next variant"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  )
}
