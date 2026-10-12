import { EyeOff, Plus } from "lucide-react"
import { useState } from "react"
import { TgButton } from "@/components/ui/tg-button"
import { TgConfirmDialog } from "@/components/ui/tg-confirm-dialog"
import { needsBulkFollowConfirm } from "@/lib/posts/discover-selection"
import { useIsF } from "../directory-prototype/variant"

const SHOWN = 3

/**
 * What a bulk action on the Directory's ticks will touch (DIR-02): the count,
 * a few handles, Follow, Dismiss and Clear. Following five or more asks first,
 * at Discover's threshold; Dismiss does not ask, because its confirmation
 * offers Undo (DIR-06).
 */
export function DirectoryBulkBar({
  ticks,
  busy,
  onFollow,
  onDismiss,
  onClear,
  followed,
}: {
  ticks: ReadonlySet<string>
  /** PROTOTYPE (A): lowercase handles you follow; their ticks are picks only. */
  followed?: ReadonlySet<string>
  /** A follow job is running for some of them. */
  busy: boolean
  onFollow: (handles: string[]) => void
  onDismiss: (handles: string[]) => void
  onClear: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const all = useIsF()
  if (ticks.size === 0) return null
  const ticked = [...ticks]
  // PROTOTYPE (A): Follow and Dismiss touch only the unfollowed ticks.
  const handles = all
    ? ticked.filter((h) => !followed?.has(h.toLowerCase()))
    : ticked
  const of = handles.length === ticked.length ? "" : ` of ${ticked.length}`
  const more = ticked.length - SHOWN
  return (
    <div
      data-testid="directory-bulk-bar"
      className={`mb-2 flex flex-wrap items-center gap-3 rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-xs ${
        // PROTOTYPE (F): one line on a phone, scrolled sideways.
        all ? "max-md:flex-nowrap max-md:overflow-x-auto max-md:*:shrink-0" : ""
      }`}
    >
      <b>{ticks.size} ticked</b>
      <span className="truncate text-app-ink/50" title={ticked.join(", ")}>
        {ticked
          .slice(0, SHOWN)
          .map((h) => `@${h}`)
          .join(", ")}
        {more > 0 ? ` +${more}` : ""}
      </span>
      <div className="ml-auto flex items-center gap-1.5">
        {all && handles.length === 0 && (
          <span className="text-app-ink/50">
            All followed: picks for the filters
          </span>
        )}
        {handles.length > 0 && (
          <TgButton
            type="button"
            variant="secondary"
            size="sm"
            loading={busy}
            onClick={() =>
              needsBulkFollowConfirm(handles.length)
                ? setConfirming(true)
                : onFollow(handles)
            }
            className="rounded-full border-blue-500/30 text-blue-600 dark:text-blue-400"
          >
            <Plus size={12} />
            Follow {handles.length}
            {of}
          </TgButton>
        )}
        {handles.length > 0 && (
          <TgButton
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => onDismiss(handles)}
            className="rounded-full"
          >
            <EyeOff size={12} />
            Dismiss {handles.length}
            {of}
          </TgButton>
        )}
        <TgButton
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={onClear}
          className="rounded-full"
        >
          Clear
        </TgButton>
      </div>
      <TgConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Follow channels?"
        description={`Follow ${handles.length} channels? Each starts syncing into your account.`}
        confirmLabel="Follow"
        confirmTestId="directory-bulk-confirm"
        onConfirm={() => {
          setConfirming(false)
          onFollow(handles)
        }}
        onCancel={() => setConfirming(false)}
      />
    </div>
  )
}
