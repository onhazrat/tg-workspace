import { Clock } from "lucide-react"
import type React from "react"
import { useMemo } from "react"
import { useData } from "../contexts/DataContext"
import { useScraper } from "../contexts/ScraperContext"
import { useSettings } from "../contexts/SettingsContext"
import type { Post } from "../types"
import { PostCardActions } from "./post-card/PostCardActions"
import { PostCardBody } from "./post-card/PostCardBody"
import { PostCardIdentity } from "./post-card/PostCardHeader"
import { PostCardMedia } from "./post-card/PostCardMedia"
import { postTime } from "./post-card/post-card-model"
import { usePostTranslation } from "./post-card/usePostTranslation"
import { RelativeTime } from "./RelativeTime"

interface PostCardProps {
  post: Post
  postSearch: string
}

export const PostCard: React.FC<PostCardProps> = ({ post, postSearch }) => {
  const { embeddingsEnabled } = useSettings()
  const { setRelatedPostSearch, addNewChannel } = useScraper()
  const { channels } = useData()
  const translation = usePostTranslation(post)

  const channel = useMemo(
    () =>
      channels.find(
        (c) => c.name.toLowerCase() === post.channelName.toLowerCase(),
      ),
    [channels, post.channelName],
  )

  return (
    <div
      data-post-key={`${post.channelName}_${post.id}`}
      className="bg-app-card border border-app-ink/10 rounded-xl shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:border-app-ink/20 transition-all duration-200 group overflow-hidden flex flex-col"
    >
      {/* Post Header */}
      <div className="flex items-center justify-between px-5 py-3 bg-app-muted/30 border-b border-app-ink/5 relative">
        <PostCardIdentity
          post={post}
          channel={channel}
          followsForwardSource={channels.some(
            (c) => c.name.toLowerCase() === post.forwardedFrom?.toLowerCase(),
          )}
          onAddChannel={addNewChannel}
          postSearch={postSearch}
        />

        <div className="relative flex items-center justify-end shrink-0">
          <span className="text-[11px] font-mono text-app-ink/60 uppercase tracking-widest flex items-center gap-1.5 bg-app-ink/5 px-2.5 py-1 rounded-full shrink-0">
            <Clock size={10} />
            <RelativeTime timestamp={postTime(post)} />
          </span>
          <PostCardActions
            post={post}
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
        </div>
      </div>

      {/* Post Body */}
      <div className="p-5 flex flex-col gap-4">
        <PostCardMedia post={post} />
        <PostCardBody
          text={translation.text}
          // A translation has no positions of its own (ADR-022).
          linkSpans={translation.text === post.text ? post.linkSpans : null}
          postSearch={postSearch}
        />
      </div>
    </div>
  )
}
