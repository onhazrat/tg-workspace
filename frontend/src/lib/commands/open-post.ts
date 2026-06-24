export interface OpenPostTarget {
  channelName: string
  postId: number
}

export function parseOpenPostInput(input: string): OpenPostTarget | null {
  const trimmed = input.trim().replace(/^@/, "")
  if (!trimmed) return null

  const colonMatch = trimmed.match(/^(\S+):(\d+)$/)
  if (colonMatch) {
    const postId = Number.parseInt(colonMatch[2], 10)
    if (Number.isNaN(postId) || postId <= 0) return null
    return { channelName: colonMatch[1], postId }
  }

  const spaceMatch = trimmed.match(/^(\S+)\s+(\d+)$/)
  if (spaceMatch) {
    const postId = Number.parseInt(spaceMatch[2], 10)
    if (Number.isNaN(postId) || postId <= 0) return null
    return { channelName: spaceMatch[1], postId }
  }

  return null
}

export function formatOpenPostTarget(target: OpenPostTarget): string {
  return `${target.channelName}:${target.postId}`
}
