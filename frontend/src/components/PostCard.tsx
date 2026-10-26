import type React from "react"
import { useData } from "../contexts/DataContext"
import { usePostsViewEdits } from "../contexts/PostsViewContext"
import { useSettings } from "../contexts/SettingsContext"
import { useSync } from "../contexts/SyncContext"
import type { Post } from "../types"
import { useSpotlight } from "./post-card/ChannelSpotlight"
import { PostCardView } from "./post-card/PostCardView"
import { usePostTranslation } from "./post-card/usePostTranslation"

interface PostCardProps {
  post: Post
  postSearch: string
  compact?: boolean
  /** Keyboard mode's Highlight is on this card. */
  highlighted?: boolean
  /** Tick or untick this Post; `shift` asks for the run since the last click. */
  onToggleSelected: (post: Post, shift: boolean) => void
}

/** `PostCardView` wired to the workspace: Follows, spotlight, translation, find related. */
export const PostCard: React.FC<PostCardProps> = ({
  post,
  postSearch,
  compact,
  highlighted,
  onToggleSelected,
}) => {
  const { embeddingsEnabled } = useSettings()
  const { setRanking } = usePostsViewEdits()
  const { addNewChannel } = useSync()
  const { channels } = useData()
  const translation = usePostTranslation(post)
  const { spotlight, enter } = useSpotlight()
  const followed = (name: string | null | undefined) =>
    channels.find((c) => c.name.toLowerCase() === name?.toLowerCase())

  return (
    <PostCardView
      post={post}
      postSearch={postSearch}
      compact={compact}
      highlighted={highlighted}
      channel={followed(post.channelName)}
      followsForwardSource={!!followed(post.forwardedFrom)}
      onAddChannel={addNewChannel}
      onShowChannel={enter && ((name) => enter(post, name))}
      spotlit={
        spotlight?.channel.toLowerCase() === post.channelName.toLowerCase()
      }
      onToggleSelected={(shift) => onToggleSelected(post, shift)}
      text={translation.text}
      translation={
        translation.translatable
          ? {
              showing: translation.showing,
              busy: translation.busy,
              onToggle: translation.toggle,
            }
          : undefined
      }
      onFindRelated={
        embeddingsEnabled
          ? () => {
              setRanking({ kind: "related", post })
              window.scrollTo({ top: 0, behavior: "smooth" })
            }
          : undefined
      }
    />
  )
}
