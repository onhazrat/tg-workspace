import type React from "react"

export const LogEmptyState: React.FC<{ message: string }> = ({ message }) => (
  <div className="py-20 text-center border border-dashed border-app-ink/10 opacity-30">
    <p className="text-[10px] uppercase font-mono tracking-[0.2em]">
      {message}
    </p>
  </div>
)
