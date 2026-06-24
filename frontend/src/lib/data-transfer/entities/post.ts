import { toast } from "sonner"

import { api } from "@/api"
import * as cache from "@/lib/cache"
import type { CommandContext } from "@/lib/commands/types"
import { bulkUpsertPosts } from "@/lib/repository"
import type { Post } from "@/types"
import type { DataEntityDef, ExportFilter, ImportResult } from "../types"

export const POST_CHUNK_SIZE = 500

function getPostDateRange(ctx: CommandContext): {
  startDate: number
  endDate: number
} {
  if (ctx.postDateRange) return ctx.postDateRange
  return { startDate: 0, endDate: Date.now() }
}

export function filterPostsSelected(
  posts: Post[],
  selectedChannels: Set<string>,
): Post[] {
  return posts.filter((post) => selectedChannels.has(post.channelName))
}

export function applyPostFilter(
  posts: Post[],
  filter: ExportFilter,
  ctx: CommandContext,
): Post[] {
  if (filter === "selected") {
    return filterPostsSelected(posts, ctx.selectedChannels)
  }
  return posts
}

async function fetchPostsFromApi(
  channelNames: string[] | undefined,
  startDate: number,
  endDate: number,
): Promise<Post[]> {
  return api.getPosts({ channelNames, startDate, endDate })
}

async function fetchAllPostsOffline(): Promise<Post[]> {
  const total = await cache.getPostCount()
  const posts: Post[] = []
  for (let offset = 0; offset < total; offset += POST_CHUNK_SIZE) {
    const chunk = await cache.getPostsChunk(offset, POST_CHUNK_SIZE)
    posts.push(...chunk)
  }
  return posts
}

export async function listPostsForFilter(
  filter: ExportFilter,
  ctx: CommandContext,
): Promise<Post[]> {
  const dateRange =
    filter === "all"
      ? { startDate: 0, endDate: Date.now() + 86_400_000 }
      : getPostDateRange(ctx)
  const { startDate, endDate } = dateRange
  const channelNames =
    filter === "selected" ? Array.from(ctx.selectedChannels) : undefined

  if (channelNames && channelNames.length === 0) {
    return []
  }

  let posts: Post[]

  if (ctx.isOffline) {
    if (channelNames?.length) {
      posts = await cache.getPostsByDateRange(channelNames, startDate, endDate)
    } else {
      posts = await fetchAllPostsOffline()
      posts = posts.filter(
        (post) => post.timestamp >= startDate && post.timestamp <= endDate,
      )
    }
    toast.info("Using local cache — may not include latest server data", {
      id: "data-transfer-offline-hint",
    })
  } else {
    const toastId = "post-fetch-progress"
    toast.info("Fetching posts…", { id: toastId })
    posts = await fetchPostsFromApi(channelNames, startDate, endDate)
    toast.dismiss(toastId)
  }

  return applyPostFilter(posts, filter, ctx)
}

export function postToCopyLine(post: Post): string {
  return `${post.channelName}/${post.id}`
}

export function filterPostImportRecords(
  records: Post[],
  filter: ExportFilter,
  ctx: CommandContext,
): Post[] {
  if (filter === "selected") {
    return filterPostsSelected(records, ctx.selectedChannels)
  }
  return records
}

export async function upsertPostRecords(
  records: Post[],
): Promise<ImportResult> {
  let imported = 0
  let failed = 0

  for (let i = 0; i < records.length; i += POST_CHUNK_SIZE) {
    const chunk = records.slice(i, i + POST_CHUNK_SIZE)
    try {
      await bulkUpsertPosts(chunk)
      imported += chunk.length
    } catch {
      failed += chunk.length
    }
  }

  return { imported, failed, skipped: 0 }
}

export const postEntityDef: DataEntityDef<"post"> = {
  entity: "post",
  singularLabel: "post",
  pluralLabel: "Posts",
  filters: ["all", "selected"],
  listForFilter: listPostsForFilter,
  toCopyLine: postToCopyLine,
  filterImportRecords: filterPostImportRecords,
  upsertRecords: (records) => upsertPostRecords(records),
}
