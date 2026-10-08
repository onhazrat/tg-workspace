import type { CardFace } from "@/lib/channels/card-zoom"
import type { Channel, ChannelStats } from "@/types"
import {
  ChannelCardActions,
  ChannelCardBadges,
  ChannelCardSyncingOverlay,
} from "./ChannelCardChrome"
import { ChannelCardFooter } from "./ChannelCardFooter"
import { ChannelCardHeader } from "./ChannelCardHeader"
import { ChannelCardMeta } from "./ChannelCardMeta"
import { ChannelCardTags } from "./ChannelCardTags"
import {
  channelCardFrameClass,
  selectionHandlers,
  selectLabel,
  settingGroupHints,
  syncProgress,
} from "./channel-card-status"

/**
 * The channel card at zooms -1, 0 and +1, drawn from a `CardFace`. Props only,
 * so every face is testable without the contexts `ChannelCard` reads: anything
 * from app state (tag suggestions' source, the Channel filter, the selection)
 * arrives as a prop.
 */
export function ChannelCardFace({
  channel,
  stats,
  face,
  inScopeCount,
  accountChannels,
  onFilterByTag,
  isSelected,
  isScraping,
  busy,
  queuePosition,
  sortRank,
  onToggleSelected,
  onToggleFreeze,
  onResetAndSync,
  onRemove,
  onSaveChannel,
  onSync,
}: {
  channel: Channel
  stats: ChannelStats | undefined
  face: CardFace
  /** In-scope post count for this channel, from the shared counts query. */
  inScopeCount: number
  /**
   * The Account's Channels, which tag suggestions are drawn from. Passed in,
   * never read from the data context, so the face renders in a test alone.
   */
  accountChannels: readonly Pick<Channel, "tags">[]
  /** Adds a tag funnel to the Channel filter. */
  onFilterByTag: (tag: string) => void
  /**
   * Among the Scope's selected Channels, the Hidden selection included. The
   * selection control shows it, and the In scope count is only meaningful
   * when it is true.
   */
  isSelected: boolean
  isScraping: boolean
  /** A sync or summary is running. */
  busy: boolean
  /** 1-based place in the sync queue, or null when not queued. */
  queuePosition: number | null
  sortRank?: number
  onToggleSelected: (shift: boolean) => void
  onToggleFreeze: () => void
  onResetAndSync: () => void
  onRemove: () => void
  /** Resolves once saved, so the tag field can send its saves in turn. */
  onSaveChannel: (patch: Partial<Channel>) => Promise<void> | void
  onSync: () => void
}) {
  const { virtualGroupTagName, inheritedSettingsHint } = settingGroupHints(
    channel.settingGroupName,
  )

  return (
    <div
      data-channel-name={channel.name}
      className={channelCardFrameClass({
        isFrozen: channel.isFrozen,
        isSelected,
        isScraping,
      })}
    >
      {isScraping && (
        <ChannelCardSyncingOverlay
          progress={syncProgress(stats)}
          clickThrough={face.bodySelects}
        />
      )}

      {face.bodySelects && (
        // The whole card is the selection toggle. It sits under Sync rather
        // than around it, because a button may not hold a button.
        <button
          type="button"
          aria-pressed={isSelected}
          aria-label={selectLabel(channel.name, isSelected)}
          {...selectionHandlers(onToggleSelected)}
          className="absolute inset-0 z-10 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ink/30"
        />
      )}

      {face.hoverActions && (
        <ChannelCardActions
          channel={channel}
          busy={busy}
          onToggleFreeze={onToggleFreeze}
          onResetAndSync={onResetAndSync}
          onRemove={onRemove}
        />
      )}

      <ChannelCardBadges
        channel={channel}
        isSelected={isSelected}
        onToggleSelected={onToggleSelected}
        queuePosition={queuePosition}
        sortRank={sortRank}
        showCheckbox={face.checkbox}
        showDetails={face.detailBadges}
      />

      <div
        className={`flex flex-col h-full ${face.bodySelects ? "p-4 pt-9" : "p-5 pt-12"}`}
      >
        <ChannelCardHeader
          channel={channel}
          showBio={face.bio}
          linkToTelegram={!face.bodySelects}
        />
        {face.meta && (
          <ChannelCardMeta
            channel={channel}
            stats={stats}
            inScopeCount={inScopeCount}
            show={face.meta}
          />
        )}

        {face.tags && (
          <ChannelCardTags
            tags={channel.tags}
            virtualGroupTagName={virtualGroupTagName}
            inheritedSettingsHint={inheritedSettingsHint}
            accountChannels={accountChannels}
            onSave={(tags) => onSaveChannel({ tags })}
            onFilterByTag={onFilterByTag}
          />
        )}

        <ChannelCardFooter
          channel={channel}
          showStartId={face.startId}
          showStatus={face.syncStatus}
          detailed={face.detailed}
          isScraping={isScraping}
          busy={busy}
          inheritedSettingsHint={inheritedSettingsHint}
          onSaveStartId={(startId) => onSaveChannel({ startId })}
          onSync={onSync}
        />
      </div>
    </div>
  )
}
