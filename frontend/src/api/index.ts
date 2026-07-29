import { aiApi } from "./ai"
import { dataApi } from "./data"
import { jobsApi } from "./jobs"
import { networkApi } from "./network"
import { ragApi } from "./rag"
import { tgApi } from "./tg"

/** Unified hand-written TG summarizer API client (REST + SSE). */
export const api = {
  ...tgApi,
  ...networkApi,
  ...aiApi,
  ...ragApi,
  ...jobsApi,
  ...dataApi,
}

export { aiApi } from "./ai"
export {
  API_BASE,
  clearStaleSession,
  headers,
  isAuthFailure,
  request,
  requestBlob,
  sseJsonStream,
  sseTextStream,
} from "./base"
export type {
  BulkFollowChannelInput,
  BulkFollowRequest,
  BulkSyncSettingsPatchBody,
  DiscoveredViaPayload,
  DiscoverProbeJob,
  FollowChannelResult,
  FollowChannelResultStatus,
  FollowJobStatus,
  SettingGroupWriteBody,
} from "./data"
export { dataApi, streamFollowJobEvents } from "./data"
export type {
  JobStatusEntry,
  RuntimeConfig,
  SyncJobChannelStatus,
  SyncJobStatus,
} from "./jobs"
export { jobsApi, subscribeSyncJobEvents } from "./jobs"
export { networkApi } from "./network"
export { ragApi } from "./rag"
export { tgApi } from "./tg"
