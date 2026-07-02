import { collectAllChannelTags } from "@/lib/channels/channel-tags"
import type { Channel, Post } from "@/types"

export function formatAllTagsForPrompt(channels: Channel[]): string {
  const tags = collectAllChannelTags(channels)
  if (tags.length === 0) return "(none yet)"
  return tags.join(", ")
}

export function formatPostsForTagPrompt(
  posts: Post[],
  selectedNames: Iterable<string>,
): string {
  const selectedSet = new Set(selectedNames)
  const grouped = new Map<string, Post[]>()

  for (const post of posts) {
    if (!selectedSet.has(post.channelName)) continue
    const list = grouped.get(post.channelName) ?? []
    list.push(post)
    grouped.set(post.channelName, list)
  }

  const sections: string[] = []
  for (const [channelName, channelPosts] of grouped.entries()) {
    const sorted = [...channelPosts].sort((a, b) => a.timestamp - b.timestamp)
    sections.push(
      [
        `### ${channelName}`,
        "Posts (chronological):",
        ...sorted.map(
          (post) =>
            `- [ID ${post.id} | ${new Date(post.timestamp).toISOString().slice(0, 10)}] ${post.text.replaceAll("\n", " ").trim()}`,
        ),
      ].join("\n"),
    )
  }

  return sections.join("\n\n")
}
