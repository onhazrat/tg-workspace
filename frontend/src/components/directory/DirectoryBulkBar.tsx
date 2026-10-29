import { EyeOff, Plus, Tag, TagsIcon } from "lucide-react"
import { useState } from "react"
import { TgButton } from "@/components/ui/tg-button"
import { TgConfirmDialog } from "@/components/ui/tg-confirm-dialog"
import { ownTags, type Tagging } from "@/lib/directory/directory-tags"
import { MAX_TICK_ALL, type Whole } from "@/lib/directory/directory-view"
import { bulkShortcut } from "@/lib/keyboard/key-list"
import { needsBulkFollowConfirm } from "@/lib/posts/discover-selection"
import { type BoostMode, DirectoryBoost } from "./DirectoryBoost"
import { TagPicker } from "./DirectoryTags"

const SHOWN = 3

const count = (n: number) => n.toLocaleString("en-US")

/**
 * What a bulk action on the Directory's Ticks will touch (DIR-02): the count,
 * a few handles, Follow, Dismiss and Clear. Following five or more asks first,
 * at Discover's threshold; Dismiss does not ask, because its confirmation
 * offers Undo (DIR-06).
 *
 * A followed row ticks like any other, as a Seed (DFP-01), so Follow and
 * Dismiss act on the unfollowed Ticks only and say "of M" when that is fewer.
 * Tag and Untag act on every Tick, followed or not (DFP-04), as the Priority
 * boost does for a `DATA_ADMIN` reader (DPF).
 *
 * In All matching (`whole.state === "held"`) every action means the whole
 * view, so the handles the callbacks get are only the page's; the caller
 * sends the view instead. Follow is off and Dismiss asks first (ADR-031).
 */
export function DirectoryBulkBar({
  ticks,
  followed,
  busy,
  onFollow,
  onDismiss,
  onClear,
  tagging,
  boostable = false,
  onBoost,
  whole,
  onTickAll,
}: {
  ticks: ReadonlySet<string>
  /** Lowercase handles the Account follows: every Follow, not only this page's. */
  followed: ReadonlySet<string>
  /** A follow job is running for some of them. */
  busy: boolean
  onFollow: (handles: string[]) => void
  onDismiss: (handles: string[]) => void
  onClear: () => void
  /** The Account's Tags, to put one on every Tick or take it off. */
  tagging?: Tagging
  /** Whether the reader holds `DATA_ADMIN`, so may set the Priority boost. */
  boostable?: boolean
  /** Sets or adds to every Tick's Priority boost. */
  onBoost?: (handles: string[], mode: BoostMode, value: number) => void
  whole?: Whole
  /** Ticks every match, or holds the view as All matching. */
  onTickAll?: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [dismissing, setDismissing] = useState(false)
  if (ticks.size === 0) return null
  const held = whole?.state === "held"
  const ticked = [...ticks]
  const handles = ticked.filter((h) => !followed.has(h.toLowerCase()))
  const of = handles.length === ticked.length ? "" : ` of ${ticked.length}`
  const more = ticked.length - SHOWN
  const total = whole ? count(whole.total) : ""
  return (
    <div
      data-testid="directory-bulk-bar"
      // One line on a phone, scrolled sideways (DFP-02).
      className="mb-2 flex flex-wrap items-center gap-3 rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-xs max-md:flex-nowrap max-md:overflow-x-auto max-md:*:shrink-0"
    >
      {held ? (
        <span>
          <b>All {total} matching.</b> Over {count(MAX_TICK_ALL)}, so they are
          held as this view, not selected: Follow and Seeds are off, and
          changing the view clears it.
        </span>
      ) : (
        <>
          <b>{ticks.size} selected</b>
          <span className="truncate text-app-ink/50" title={ticked.join(", ")}>
            {ticked
              .slice(0, SHOWN)
              .map((h) => `@${h}`)
              .join(", ")}
            {more > 0 ? ` +${more}` : ""}
          </span>
        </>
      )}
      {whole?.state === "ticked" && (
        <span>All {total} matching are selected.</span>
      )}
      {whole?.state === "offer" && onTickAll && (
        <button
          type="button"
          onClick={onTickAll}
          className="text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
        >
          {whole.total > MAX_TICK_ALL
            ? `Act on all ${total} matching`
            : `Tick all ${total} that match`}
        </button>
      )}
      <div className="ml-auto flex items-center gap-1.5">
        {boostable && onBoost && (
          <DirectoryBoost
            onBoost={(mode, value) => onBoost(ticked, mode, value)}
          />
        )}
        {tagging && (
          <>
            <TagPicker
              tags={tagging.tags}
              align="end"
              onPick={(name) => tagging.onTag(name, ticked)}
              trigger={
                <TgButton
                  type="button"
                  variant="secondary"
                  size="sm"
                  data-testid="directory-bulk-tag"
                  className="rounded-full"
                >
                  <Tag size={12} />
                  Tag {held ? "all" : ticked.length}
                </TgButton>
              }
            />
            {ownTags(tagging.tags).length > 0 && (
              <TagPicker
                tags={tagging.tags}
                create={false}
                align="end"
                onPick={(name) => tagging.onUntag(name, ticked)}
                trigger={
                  <TgButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-testid="directory-bulk-untag"
                    className="rounded-full"
                  >
                    <TagsIcon size={12} />
                    Untag
                  </TgButton>
                }
              />
            )}
          </>
        )}
        {held ? (
          <>
            <span title={`Follow acts on ${count(MAX_TICK_ALL)} or fewer`}>
              <TgButton
                type="button"
                variant="secondary"
                size="sm"
                disabled
                {...bulkShortcut("F")}
                className="rounded-full"
              >
                <Plus size={12} />
                Follow
              </TgButton>
            </span>
            <TgButton
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy}
              {...bulkShortcut("D")}
              onClick={() => setDismissing(true)}
              className="rounded-full"
            >
              <EyeOff size={12} />
              Dismiss all
            </TgButton>
          </>
        ) : handles.length === 0 ? (
          <span className="text-app-ink/50">All followed</span>
        ) : (
          <>
            <TgButton
              type="button"
              variant="secondary"
              size="sm"
              loading={busy}
              {...bulkShortcut("F")}
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
            <TgButton
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy}
              {...bulkShortcut("D")}
              onClick={() => onDismiss(handles)}
              className="rounded-full"
            >
              <EyeOff size={12} />
              Dismiss {handles.length}
              {of}
            </TgButton>
          </>
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
      <TgConfirmDialog
        open={dismissing}
        onOpenChange={setDismissing}
        title="Dismiss channels?"
        description={`Dismiss up to ${total} channels? Followed ones are skipped. This hides them in Discover and the Directory. There is no Undo for more than ${count(MAX_TICK_ALL)}.`}
        confirmLabel="Dismiss"
        confirmTestId="directory-bulk-dismiss-confirm"
        onConfirm={() => {
          setDismissing(false)
          onDismiss(handles)
        }}
        onCancel={() => setDismissing(false)}
      />
    </div>
  )
}
