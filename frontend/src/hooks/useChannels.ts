import { useQuery, useQueryClient } from "@tanstack/react-query";

import { normalizeChannel } from "@/lib/channelNormalize";
import { listChannelsWithStats } from "@/lib/repository";
import type { Channel, ChannelStats } from "@/types";

import { queryKeys, SUMMARIZER_STALE_TIME } from "./queryKeys";

export interface ChannelsQueryResult {
  channels: Channel[];
  channelStats: Record<string, ChannelStats>;
}

async function fetchChannels(): Promise<ChannelsQueryResult> {
  const { channels, stats } = await listChannelsWithStats();
  return {
    channels: channels.map(normalizeChannel),
    channelStats: stats,
  };
}

export function useChannelsQuery() {
  return useQuery({
    queryKey: queryKeys.channels,
    queryFn: fetchChannels,
    staleTime: SUMMARIZER_STALE_TIME,
    refetchOnWindowFocus: true,
  });
}

export function useInvalidateChannels() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.channels });
}
