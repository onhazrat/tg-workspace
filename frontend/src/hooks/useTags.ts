/**
 * The Account's Tags as a whole (DFP-04, ADR-029): the list with counts, and
 * tagging, untagging, renaming and deleting. Server state only; nothing about
 * a Tag is kept in the browser. Every write refetches the Tags, the Directory
 * (rows carry their Tags) and the Channels (a followed Channel shows its Tags
 * there too).
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"
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
import type { TagChoices, Tagging } from "@/lib/directory/directory-tags"
import { queryKeys } from "./queryKeys"
import { useSettingGroupsQuery } from "./useSettingGroups"

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
    /** Hand `onTicks` the handles carrying `name` now, `group:` names included. */
    tickTag: async (name: string, onTicks: (handles: string[]) => void) => {
      try {
        const { handles } = await dataListTagChannels({ query: { name } })
        onTicks(handles)
      } catch (error) {
        toast.error(errorText(error, "The Tag's channels did not load."))
      }
    },
  }
}

/** The Tags as the Directory tab wires them: rows, the panel and the filter. */
export function useDirectoryTags() {
  const tags = useTags()
  const groups = useSettingGroupsQuery()
  const tagging: Tagging = {
    tags: tags.tags,
    onTag: (name, handles) => void tags.tag(name, handles),
    onUntag: (name, handles) => void tags.untag(name, handles),
  }
  const choices: TagChoices = {
    tags: tags.tags,
    groups: (groups.data ?? []).map((g) => g.name),
    loaded: tags.loaded && groups.isSuccess,
  }
  return { tags, tagging, choices }
}
