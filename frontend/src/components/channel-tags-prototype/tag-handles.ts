// PROTOTYPE (channel-tags-usage): the handles of each Tag a Requests filter
// names, fetched only for those Tags. Never merge.
import { useQueries } from "@tanstack/react-query"
import { dataListTagChannels } from "@/client"
import { queryKeys } from "@/hooks/queryKeys"

export function useTagHandles(
  names: string[],
): (tag: string) => ReadonlySet<string> | undefined {
  const results = useQueries({
    queries: names.map((name) => ({
      // Under the Tags key, so a rename or delete refetches it with the list.
      queryKey: [...queryKeys.tags, "handles", name],
      queryFn: async () => {
        const { handles } = await dataListTagChannels({ query: { name } })
        return new Set(handles.map((h) => h.toLowerCase()))
      },
    })),
  })
  const byName = new Map(names.map((n, i) => [n, results[i]?.data]))
  return (tag) => byName.get(tag)
}
