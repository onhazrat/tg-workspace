import { aiApi } from "./ai";
import { dataApi } from "./data";
import { jobsApi } from "./jobs";
import { networkApi } from "./network";
import { ragApi } from "./rag";
import { tgApi } from "./tg";

/** Unified hand-written TG summarizer API client (REST + SSE). */
export const api = {
  ...tgApi,
  ...networkApi,
  ...aiApi,
  ...ragApi,
  ...jobsApi,
  ...dataApi,
};

export { aiApi } from "./ai";
export { dataApi } from "./data";
export { jobsApi } from "./jobs";
export type { JobStatusEntry, SyncJobChannelStatus, SyncJobStatus } from "./jobs";
export { networkApi } from "./network";
export { ragApi } from "./rag";
export { tgApi } from "./tg";
export {
  API_BASE,
  clearStaleSession,
  headers,
  isAuthFailure,
  request,
  requestBlob,
  sseJsonStream,
  sseTextStream,
} from "./base";
export { subscribeSyncJobEvents } from "./jobs";
