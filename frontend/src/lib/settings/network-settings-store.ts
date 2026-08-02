import { api } from "@/api"

/**
 * The `network` settings row.
 *
 * Pure passthrough — this pair was always server-backed, with no IndexedDB
 * mirror and no etag, so A3 only moves it out of `repository.ts` rather than
 * changing anything. `AppSetting` rows are a single JSON blob per section, so
 * there is no list to invalidate.
 */

/** The slice of `api` used here, injectable as a test seam (see `ChannelsApi`). */
export type NetworkSettingsApi = Pick<
  typeof api,
  "getNetworkSettings" | "putNetworkSettings"
>

export async function loadNetworkSettings(
  client: NetworkSettingsApi = api,
): Promise<Record<string, unknown>> {
  return (await client.getNetworkSettings()).value
}

export async function saveNetworkSettings(
  value: Record<string, unknown>,
  client: NetworkSettingsApi = api,
): Promise<Record<string, unknown>> {
  return (await client.putNetworkSettings(value)).value
}
