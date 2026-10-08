/** The key legend in the corner while keyboard mode is on, on either tab. */
export function KeyHelp({
  rows,
}: {
  rows: readonly (readonly [key: string, what: string])[]
}) {
  return (
    <div className="fixed bottom-4 left-4 z-50 hidden rounded-xl border border-app-ink/10 bg-app-card/95 p-3 text-[11px] shadow-lg backdrop-blur md:block">
      {rows.map(([key, what]) => (
        <div key={key} className="flex gap-3">
          <kbd className="w-10 font-mono text-app-ink">{key}</kbd>
          <span className="text-app-ink/60">{what}</span>
        </div>
      ))}
    </div>
  )
}
