import { toast } from "sonner"

import { api } from "@/api"
import type { CommandContext } from "@/lib/commands/types"
import { bulkUpsertPosts } from "@/lib/repository"
import type { Post } from "@/types"
import type { DataEntityDef, ExportFilter, ImportResult } from "../types"

export const POST_CHUNK_SIZE = 500

/**
 * Rows per request when reading the corpus for an export (A2).
 *
 * `MAX_POST_PAGE_SIZE` in `app/services/posts.py`; asking for more is a 422, so
 * this is the largest page the server will serve and the fewest round trips an
 * export can make.
 */
export const EXPORT_PAGE_SIZE = 5000

/**
 * Safety bound on the export loop, in pages.
 *
 * Paging until a short page arrives is correct but unbounded in principle. This
 * makes a runaway loop a loud error rather than a browser that grows until it
 * dies — the failure mode that motivated the whole server-side-reads workstream.
 */
const MAX_EXPORT_PAGES = 1000

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

/**
 * Every post in range, paged.
 *
 * This used to be a single `api.getPosts({channelNames, startDate, endDate})`
 * with **no `limit`** — which does not mean "everything". `PostFeedRequest.limit`
 * defaults to 500, so an export silently truncated to the first 500 posts while
 * the IndexedDB branch of the same function exported the lot. The two disagreed
 * by however many posts the operator had.
 * `tests/api/test_export_paging.py` pins the endpoint behaviour this pages against.
 *
 * The termination condition is a *short* page, not an empty one — but a corpus
 * that is an exact multiple of the page size still costs one extra request, and
 * that is correct rather than an off-by-one.
 */
export async function fetchAllPostsFromServer(
  channelNames: string[] | undefined,
  startDate: number,
  endDate: number,
  onProgress: (fetched: number) => void = () => {},
  // Injected rather than imported so this is testable without `mock.module`,
  // which is process-wide in Bun and would contaminate every other file that
  // imports `@/api`. Same pattern as `computeScopedPosts`.
  fetchPage: typeof api.getPostsFeed = api.getPostsFeed,
): Promise<Post[]> {
  const posts: Post[] = []
  for (let page = 0; page < MAX_EXPORT_PAGES; page++) {
    const batch = await fetchPage({
      channelNames,
      startDate,
      endDate,
      sort: "time",
      limit: EXPORT_PAGE_SIZE,
      offset: page * EXPORT_PAGE_SIZE,
    })
    posts.push(...batch)
    onProgress(posts.length)
    if (batch.length < EXPORT_PAGE_SIZE) return posts
  }
  throw new Error(
    `Export exceeded ${MAX_EXPORT_PAGES} pages ` +
      `(${MAX_EXPORT_PAGES * EXPORT_PAGE_SIZE} posts) — narrow the date range`,
  )
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

  // No IndexedDB branch any more (A2). It was the last direct reader of the
  // mirror outside `lib/cache.ts` itself, and under ADR-009 PostgreSQL is
  // authoritative — an export assembled from a possibly-stale local copy is
  // worse than no export, because nothing about the file says it was stale.
  // The command is disabled while offline instead; see `postEntityDef`.
  const toastId = "post-fetch-progress"
  toast.info("Fetching posts…", { id: toastId })
  try {
    const posts = await fetchAllPostsFromServer(
      channelNames,
      startDate,
      endDate,
      (fetched) => {
        toast.info(`Fetching posts… ${fetched.toLocaleString()}`, {
          id: toastId,
        })
      },
    )
    return applyPostFilter(posts, filter, ctx)
  } finally {
    toast.dismiss(toastId)
  }
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
  requiresServer: true,
  listForFilter: listPostsForFilter,
  toCopyLine: postToCopyLine,
  filterImportRecords: filterPostImportRecords,
  upsertRecords: (records) => upsertPostRecords(records),
}
