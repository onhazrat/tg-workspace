import type { CardFace } from "@/lib/channels/card-zoom"
import type { Channel, ChannelStats } from "@/types"
import {
  AltCardLayout,
  isAltLayout,
} from "../channel-card-prototype/CardLayouts"
import { useCardVariant } from "../channel-card-prototype/shared"
import {
  CHANNEL_SHORTCUTS,
  KBD_RING,
} from "../channel-grid/ChannelGridKeyboard"
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
 * so every face is testable without the contexts `ChannelCard` reads.
 */
export type ChannelCardFaceProps = {
  channel: Channel
  stats: ChannelStats | undefined
  face: CardFace
  /** In-scope post count for this channel, from the shared counts query. */
  inScopeCount: number
  isSelected: boolean
  isScraping: boolean
  /** A sync or summary is running. */
  busy: boolean
  /** 1-based place in the sync queue, or null when not queued. */
  queuePosition: number | null
  sortRank?: number
  /** Keyboard mode has ringed this card. */
  keyboardRing?: boolean
  onToggleSelected: (shift: boolean) => void
  onToggleFreeze: () => void
  onResetAndSync: () => void
  onRemove: () => void
  onSaveChannel: (patch: Partial<Channel>) => void
  onSync: () => void
}

export function ChannelCardFace(props: ChannelCardFaceProps) {
  // PROTOTYPE: E, F and G rethink the card and the detailed card; compact
  // cards stay D's.
  const variant = useCardVariant()
  if (!props.face.bodySelects && isAltLayout(variant))
    return <AltCardLayout variant={variant} {...props} />
  return <DCardFace {...props} />
}

function DCardFace({
  channel,
  stats,
  face,
  inScopeCount,
  isSelected,
  isScraping,
  busy,
  queuePosition,
  sortRank,
  keyboardRing = false,
  onToggleSelected,
  onToggleFreeze,
  onResetAndSync,
  onRemove,
  onSaveChannel,
  onSync,
}: ChannelCardFaceProps) {
  const { virtualGroupTagName, inheritedSettingsHint } = settingGroupHints(
    channel.settingGroupName,
  )

  return (
    <div
      data-channel-name={channel.name}
      data-kbd-selected={keyboardRing ? "" : undefined}
      className={`${channelCardFrameClass({
        isFrozen: channel.isFrozen,
        isSelected,
        isScraping,
      })} ${KBD_RING}`}
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
          data-shortcut={CHANNEL_SHORTCUTS.select}
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
          fullBio={face.detailed}
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
            onSave={(tags) => onSaveChannel({ tags })}
          />
        )}

        <ChannelCardFooter
          channel={channel}
          stats={stats}
          showStartId={face.startId}
          showStatus={face.syncStatus}
          isScraping={isScraping}
          busy={busy}
          inheritedSettingsHint={inheritedSettingsHint}
          onSaveStartId={(startId) => onSaveChannel({ startId })}
          onSync={onSync}
          detailed={face.detailed}
        />
      </div>
    </div>
  )
}
