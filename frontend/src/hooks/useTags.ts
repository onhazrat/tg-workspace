/**
 * The Account's Tags as a whole (DFP-04, ADR-029): the list with counts, and
 * tagging, untagging, renaming and deleting. Server state only; nothing about
 * a Tag is kept in the browser. Every write refetches the Tags, the Directory
 * (rows carry their Tags) and the Channels (a followed Channel shows its Tags
 * there too).
 */
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  type DirectoryViewRequest,
  dataAddTagChannels,
  dataDeleteTag,
  dataListTagChannels,
  dataListTags,
  dataRemoveTagChannels,
  dataRenameTag,
  type TagResponse,
} from "@/client"
import { errorText } from "@/lib/artifacts/artifact-run"
import { queryClient } from "@/lib/queryClient"
import type { TagChoices, Tagging } from "@/lib/directory/directory-tags"
import { byTagUse } from "@/lib/tags/tag-use"
import { queryKeys } from "./queryKeys"
import { useSettingGroupsQuery } from "./useSettingGroups"
import { recordTagUse, useTagUses } from "./useTagUses"

const NO_TAGS: TagResponse[] = []

/**
 * The most handles one Tag request carries: the server's cap on a bulk
 * write's handles, a trust boundary it keeps. A Tag is not capped, so a longer list goes in
 * batches of this size.
 */
export const TAG_BATCH = 10_000

/** Run `send` on each batch of `handles`, one after the other. */
async function inBatches(
  handles: string[],
  send: (batch: string[]) => Promise<unknown>,
) {
  for (let i = 0; i < handles.length; i += TAG_BATCH)
    await send(handles.slice(i, i + TAG_BATCH))
}

export function useTags() {
  const queryClient = useQueryClient()
  const list = useQuery({
    queryKey: queryKeys.tags,
    queryFn: () => dataListTags(),
  })

  const write = async (work: () => Promise<unknown>, failure: string) => {
    try {
      await work()
    } catch (error) {
      toast.error(errorText(error, failure))
    } finally {
      await Promise.all(
        [queryKeys.tags, queryKeys.directory, queryKeys.channels].map(
          (queryKey) => queryClient.invalidateQueries({ queryKey }),
        ),
      )
    }
  }

  return {
    tags: list.data ?? NO_TAGS,
    /** Until the list arrives nothing is known to be missing. */
    loaded: list.isSuccess,
    tag: (name: string, handles: string[]) =>
      write(
        () =>
          inBatches(handles, (batch) =>
            dataAddTagChannels({ body: { name, handles: batch } }),
          ),
        "The Tag did not save.",
      ),
    /** Tag every entry a Directory view matches: All matching (ADR-031). */
    tagView: (name: string, view: DirectoryViewRequest) =>
      write(async () => {
        const { changed } = await dataAddTagChannels({ body: { name, view } })
        toast.success(`Tagged ${changed} with ${name}`)
      }, "The Tag did not save."),
    untagView: (name: string, view: DirectoryViewRequest) =>
      write(async () => {
        const { changed } = await dataRemoveTagChannels({
          body: { name, view },
        })
        toast.success(`Took ${name} off ${changed}`)
      }, "The Tag was not removed."),
    untag: (name: string, handles: string[]) =>
      write(
        () =>
          inBatches(handles, (batch) =>
            dataRemoveTagChannels({ body: { name, handles: batch } }),
          ),
        "The Tag was not removed.",
      ),
    rename: (name: string, to: string) =>
      write(
        () => dataRenameTag({ body: { name, to } }),
        "The Tag was not renamed.",
      ),
    remove: (name: string) =>
      write(
        () => dataDeleteTag({ body: { name } }),
        "The Tag was not deleted.",
      ),
  }
}

const tagHandlesQuery = (name: string) => ({
  queryKey: queryKeys.tagHandles(name),
  queryFn: async () => {
    const { handles } = await dataListTagChannels({ query: { name } })
    return new Set(handles.map((h) => h.toLowerCase()))
  },
})

/** The handles carrying `name` now, lowercased: one Tag's, never every Tag's. */
export const fetchTagHandles = (name: string) =>
  queryClient.fetchQuery(tagHandlesQuery(name))

/** Each of `names`' handles, lowercased; undefined while one loads. */
export function useTagHandles(
  names: string[],
): (name: string) => ReadonlySet<string> | undefined {
  const results = useQueries({ queries: names.map(tagHandlesQuery) })
  const byName = new Map(names.map((name, i) => [name, results[i]?.data]))
  return (name) => byName.get(name)
}

/** Record a Directory Tag use once `write` is done, so a new Tag exists. */
const usedAfter = (write: Promise<void>, name: string) =>
  void write.then(() => recordTagUse("directory", name))

/**
 * The Tags as the Directory tab wires them: rows, the panel and the filter,
 * every list in the Directory's Tag use order (TGU-03). Tagging or untagging
 * by hand records a use.
 */
export function useDirectoryTags() {
  const tags = useTags()
  const groups = useSettingGroupsQuery()
  const score = useTagUses("directory")
  const ordered = byTagUse(
    tags.tags,
    score,
    (t) => t.name,
    (t) => t.channels,
  )
  const tagging: Tagging = {
    tags: ordered,
    onTag: (name, handles) => usedAfter(tags.tag(name, handles), name),
    onUntag: (name, handles) => usedAfter(tags.untag(name, handles), name),
  }
  /** Tag or untag every entry a view matches, then record the use. */
  const viewTagging = {
    onTag: (name: string, view: DirectoryViewRequest) =>
      usedAfter(tags.tagView(name, view), name),
    onUntag: (name: string, view: DirectoryViewRequest) =>
      usedAfter(tags.untagView(name, view), name),
  }
  const choices: TagChoices = {
    tags: ordered,
    groups: (groups.data ?? []).map((g) => g.name),
    loaded: tags.loaded && groups.isSuccess,
  }
  return { tags, tagging, viewTagging, choices }
}
