/**
 * Compile-time guard on **which client each call belongs to** (F2).
 *
 * ADR-006 keeps two API clients, and the line between them is not a matter of
 * taste: a call belongs on the generated client exactly when its response type
 * is at least as useful as the hand-written one. Two things make it less useful,
 * and they are different problems:
 *
 * 1. **An open model** (`ConfigDict(extra="allow")`) renders as a top-level
 *    `[key: string]: unknown`, so every conditional key riding in `extra`
 *    arrives as `unknown`.
 * 2. **All-optional fields.** OpenAPI cannot say "has a server-side default,
 *    therefore always present", so `timestamp: int = 0` emits as
 *    `timestamp?: number`. A model can be perfectly closed and still not be
 *    assignable to a hand-written type that knows the field is always there.
 *
 * **This is a source file, not a test file, on purpose** — the same reason as
 * `types.conform.ts`. `tsconfig.build.json` excludes `src/**\/*.test.*`, so
 * assertions in a test would never be type-checked by `bun run build`.
 *
 * ## Why a comment would not have been enough
 *
 * Openness is a backend decision, one `model_config` line away in
 * `app/schemas/`. Adding `extra="allow"` to a model F2 moved would silently
 * degrade its consumers to `unknown` with no error anywhere — the call still
 * compiles, the fields just stop being typed. These assertions fail the build
 * instead.
 *
 * The reverse direction is checked too, and is the more useful half: the models
 * that kept hand-written wrappers are asserted to still be **open**. If a
 * backend change closes one, the build breaks and whoever did it is told the
 * call can now move — which is how a deliberate exception stays deliberate
 * rather than decaying into a leftover nobody dares touch.
 *
 * ## Measure openness here, not with grep
 *
 * The plan's original one-liner counted `[key: string]` inside a type's source
 * text. That is wrong in both directions, because it also counts index
 * signatures on *nested* fields: it reported `ScrapeChannelResponse` and
 * `PostResponse` as open when both are closed at the top level and merely carry
 * a loose `posts` / `media` column. `IsClosed<T>` below is the real test —
 * `string extends keyof T` holds only for a genuine top-level index signature.
 */

import type {
  BadProxy,
  BotInfoResponse,
  ChannelInfoResponse,
  ChannelSyncProgress,
  JobStatusEntry,
  PostResponse,
  ProxyHealthResponse,
  PublishResponse,
  RagEmbedResponse,
  RagStatusResponse,
  RuntimeConfigResponse,
  SyncJobStatusResponse,
  TestProxyResponse,
  TorIpResponse,
  TorStatusResponse,
} from "@/client"
import type { Post } from "@/types"

/**
 * `true` when `T` carries no top-level index signature.
 *
 * `string extends keyof T` holds only for a type with a `[key: string]` member:
 * a closed object's `keyof` is a union of string *literals*, and `string` is not
 * assignable to a literal union.
 */
type IsClosed<T> = string extends keyof T ? false : true

/** Fails to compile unless `T` is exactly `true`. */
type Assert<T extends true> = T

/** Reads better than `IsClosed<T> extends false ? true : false` at each site. */
type IsOpen<T> = IsClosed<T> extends false ? true : false

// ---------------------------------------------------------------------------
// Moved to the generated client — these must stay closed.
// ---------------------------------------------------------------------------

export type RuntimeConfigIsClosed = Assert<IsClosed<RuntimeConfigResponse>>
export type SyncJobStatusIsClosed = Assert<IsClosed<SyncJobStatusResponse>>
export type ChannelSyncProgressIsClosed = Assert<IsClosed<ChannelSyncProgress>>
export type ProxyHealthIsClosed = Assert<IsClosed<ProxyHealthResponse>>
export type BadProxyIsClosed = Assert<IsClosed<BadProxy>>
export type TorIpIsClosed = Assert<IsClosed<TorIpResponse>>
export type RagStatusIsClosed = Assert<IsClosed<RagStatusResponse>>
export type RagEmbedIsClosed = Assert<IsClosed<RagEmbedResponse>>
export type ChannelInfoIsClosed = Assert<IsClosed<ChannelInfoResponse>>
export type PublishIsClosed = Assert<IsClosed<PublishResponse>>

// ---------------------------------------------------------------------------
// Kept hand-written because the model is open. If one of these starts failing,
// the model was closed server-side and the call should move.
// ---------------------------------------------------------------------------

/** `pauseUntil` and `detail` are conditional and ride in `extra`. */
export type JobStatusEntryIsStillOpen = Assert<IsOpen<JobStatusEntry>>

/** `autoSpawned` exists only on the Tor-enabled branch. */
export type TorStatusIsStillOpen = Assert<IsOpen<TorStatusResponse>>

/** Success carries `ip`/`latency`, failure carries `error`. */
export type TestProxyIsStillOpen = Assert<IsOpen<TestProxyResponse>>

/** Forwards the raw Bot API reply, deliberately unmodelled. */
export type BotInfoIsStillOpen = Assert<IsOpen<BotInfoResponse>>

// ---------------------------------------------------------------------------
// Kept hand-written for the *other* reason: closed, but not assignable.
// ---------------------------------------------------------------------------

/**
 * `ragSearch` stays hand-written even though `RagSearchResponse` is closed.
 *
 * It carries `Array<RagSearchHit>` and each hit carries a `PostResponse`. That
 * model is closed too — but every field on it is optional, because each has a
 * server-side default that OpenAPI cannot express. So `PostResponse` is *not*
 * assignable to the frontend `Post`, which knows `text`, `date` and `timestamp`
 * are always present. Moving the call would hand callers a type that has to be
 * cast back before it is usable.
 *
 * This assertion holds while that remains true; if `PostResponse` ever becomes
 * assignable to `Post`, it fails and `ragSearch` can move.
 */
export type PostResponseIsNotAPost = Assert<
  PostResponse extends Post ? false : true
>
