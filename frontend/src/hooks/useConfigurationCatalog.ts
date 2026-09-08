import { useQuery } from "@tanstack/react-query"
import { api } from "@/api"

export function useConfigurationCatalog(enabled: boolean) {
  return useQuery({
    queryKey: ["configuration-catalog"],
    queryFn: api.getConfigurationCatalog,
    enabled,
    staleTime: 30_000,
  })
}
