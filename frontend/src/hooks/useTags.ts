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
  dataAddTagChannels,
  dataDeleteTag,
  dataListTagChannels,
  dataListTags,
  dataRemoveTagChannels,
  dataRenameTag,
  type TagResponse,
} from "@/client"
import type { RowTagging } from "@/components/directory/DirectoryTable"
import type { TagChoices } from "@/components/directory/directory-vocabulary"
import { errorText } from "@/lib/artifacts/artifact-run"
import { queryKeys } from "./queryKeys"
import { useSettingGroupsQuery } from "./useSettingGroups"

const NO_TAGS: TagResponse[] = []

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
        () => dataAddTagChannels({ body: { name, handles } }),
        "The Tag did not save.",
      ),
    untag: (name: string, handles: string[]) =>
      write(
        () => dataRemoveTagChannels({ body: { name, handles } }),
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
    /** The handles carrying `name` now, `group:` names included. */
    handlesOf: async (name: string) =>
      (await dataListTagChannels({ query: { name } })).handles,
  }
}

/** The Tags as the Directory tab wires them: rows, the panel and the filter. */
export function useDirectoryTags() {
  const tags = useTags()
  const groups = useSettingGroupsQuery()
  const tagging: RowTagging = {
    tags: tags.tags,
    onTag: (handle, name, on) =>
      void (on ? tags.tag : tags.untag)(name, [handle]),
  }
  const choices: TagChoices = {
    tags: tags.tags,
    groups: (groups.data ?? []).map((g) => g.name),
    loaded: tags.loaded && groups.isSuccess,
  }
  return { tags, tagging, choices }
}
