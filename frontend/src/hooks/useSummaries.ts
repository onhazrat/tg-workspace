import { useQuery, useQueryClient } from "@tanstack/react-query";

import { listSummaries } from "@/lib/repository";
import type { Summary } from "@/types";

import { queryKeys, SUMMARIZER_STALE_TIME } from "./queryKeys";

export function useSummariesQuery() {
  return useQuery({
    queryKey: queryKeys.summaries,
    queryFn: async () => {
      const history = await listSummaries();
      return history.sort((a, b) => b.timestamp - a.timestamp) as Summary[];
    },
    staleTime: SUMMARIZER_STALE_TIME,
    refetchOnWindowFocus: true,
  });
}

export function useInvalidateSummaries() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.summaries });
}
