import { useQuery } from "@tanstack/react-query"
import { dataGetConfigurationCatalog } from "@/client"
import { queryKeys } from "@/hooks/queryKeys"

export function useConfigurationCatalog(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.configurationCatalog,
    queryFn: () => dataGetConfigurationCatalog(),
    enabled,
    retry: false,
    staleTime: 30_000,
  })
}
