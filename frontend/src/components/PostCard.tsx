import type React from "react"
import { useData } from "../contexts/DataContext"
import { useScraper } from "../contexts/ScraperContext"
import { useSettings } from "../contexts/SettingsContext"
import type { Post } from "../types"
import { PostCardView } from "./post-card/PostCardView"
import { usePostTranslation } from "./post-card/usePostTranslation"

interface PostCardProps {
  post: Post
  postSearch: string
  compact?: boolean
  keyboard?: boolean
}

/** `PostCardView` wired to the workspace: Follows, translation, find related. */
export const PostCard: React.FC<PostCardProps> = ({
  post,
  postSearch,
  compact,
  keyboard,
}) => {
  const { embeddingsEnabled } = useSettings()
  const { setRelatedPostSearch, addNewChannel } = useScraper()
  const { channels } = useData()
  const translation = usePostTranslation(post)
  const followed = (name: string | null | undefined) =>
    channels.find((c) => c.name.toLowerCase() === name?.toLowerCase())

  return (
    <PostCardView
      post={post}
      postSearch={postSearch}
      compact={compact}
      keyboard={keyboard}
      channel={followed(post.channelName)}
      followsForwardSource={!!followed(post.forwardedFrom)}
      onAddChannel={addNewChannel}
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
              setRelatedPostSearch(post)
              window.scrollTo({ top: 0, behavior: "smooth" })
            }
          : undefined
      }
    />
  )
}
