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
  ChatArtifactResponse,
  ChatSessionListItemResponse,
  DiscoverReportResponse,
  DiscoveryArtifactResponse,
  JobStatusEntry,
  MyBudgetUsage,
  MyQuotaResponse,
  PostResponse,
  ProxyHealthResponse,
  PublishResponse,
  QuotaLimitsResponse,
  QuotaUsageEntry,
  QuotaUsageResponse,
  RagEmbedResponse,
  RagStatusResponse,
  RuntimeConfigResponse,
  SummaryArtifactResponse,
  SyncJobStatusResponse,
  TagArtifactResponse,
  TagRunResponse,
  TestProxyResponse,
  TorIpResponse,
  TorStatusResponse,
  ViewAsSessionEntry,
  ViewAsSessionResponse,
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

/**
 * `isStarred`, `note`, `postSearch` and the `semanticSearch*` flags are
 * conditional per row and ride in `extra`, exactly as they do on `Summary` —
 * which is why chat sessions are hand-written on the same grounds.
 */
export type ChatSessionListItemIsStillOpen = Assert<
  IsOpen<ChatSessionListItemResponse>
>

// ---------------------------------------------------------------------------
// Tag runs and Discover reports: closed, and they must stay that way.
//
// Both gained `isStarred`/`note` when History became one list over all four
// artifact kinds. Those keys are **declared** on the schemas rather than left
// to ride in an open `extra` bag, and the assertion below is what keeps that
// decision from being quietly reversed.
//
// The reason is concrete: `frontend/src/types.ts` derives `TagRun` from
// `TagRunResponse`, and `Omit<>` over a top-level index signature collapses
// every named field to `unknown`. Opening the model was tried during this work
// and broke `TagView` in exactly that way — which is the 190-error failure the
// types.ts header documents, reproduced in miniature.
// ---------------------------------------------------------------------------

export type TagRunIsClosed = Assert<IsClosed<TagRunResponse>>
export type DiscoverReportIsClosed = Assert<IsClosed<DiscoverReportResponse>>

// ---------------------------------------------------------------------------
// The quota ledger (ticket 08): generated, and the identifying fields are not
// optional.
//
// The per-Budget counts *are* optional — they have server-side defaults, and
// OpenAPI cannot say "defaulted, therefore always present" — but `userId`,
// `email` and `day` are required, so this is not the all-optional downgrade
// that keeps `ragSearch` hand-written. Asserted rather than assumed because the
// difference is one `= 0` on the backend model away.
// ---------------------------------------------------------------------------

export type QuotaUsageIsClosed = Assert<IsClosed<QuotaUsageResponse>>
export type QuotaUsageEntryIsClosed = Assert<IsClosed<QuotaUsageEntry>>
export type QuotaUsageEntryIdentifiesItsAccount = Assert<
  QuotaUsageEntry extends { userId: string; email: string } ? true : false
>

// ---------------------------------------------------------------------------
// The limits and the account's own view (ticket 24): generated for the same
// reason, plus one the ledger did not have.
//
// `status` decides which persistent banner the app shows, and the three values
// it can take are the whole of the ticket's fourth checkbox. It is **required**
// on the wire, which took removing its server-side default: OpenAPI marks a
// defaulted field optional, so the browser would have had to invent a fallback
// for a missing key — and the only sane fallback is "normal", which is "your
// work is running" shown to an account whose work has stopped.
//
// That is the assertion below. It is not decoration: adding `= "normal"` back
// to the backend model breaks this line, which is the only place that would
// notice.
// ---------------------------------------------------------------------------

export type MyQuotaIsClosed = Assert<IsClosed<MyQuotaResponse>>
export type MyBudgetUsageIsClosed = Assert<IsClosed<MyBudgetUsage>>
export type MyBudgetUsageStatesItself = Assert<
  MyBudgetUsage extends { budget: string; status: string } ? true : false
>
export type QuotaLimitsIsClosed = Assert<IsClosed<QuotaLimitsResponse>>

// ---------------------------------------------------------------------------
// The unified artifact list: closed on purpose, so it stays generated.
//
// It is a projection over named columns rather than a row with an `extra` bag,
// which is what lets the four kinds be a real TypeScript discriminated union
// instead of one type with four optional fields.
// ---------------------------------------------------------------------------

export type SummaryArtifactIsClosed = Assert<IsClosed<SummaryArtifactResponse>>
export type ChatArtifactIsClosed = Assert<IsClosed<ChatArtifactResponse>>
export type TagArtifactIsClosed = Assert<IsClosed<TagArtifactResponse>>
export type DiscoveryArtifactIsClosed = Assert<
  IsClosed<DiscoveryArtifactResponse>
>

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

// ---------------------------------------------------------------------------
// View-as (ticket 26): generated, and every field the ribbon needs is required.
//
// `MyBudgetUsage`'s reason, sharpened. OpenAPI marks a defaulted field
// optional, so a server-side default on any of these would make the browser
// invent a fallback — and there is no honest fallback for "which account am I
// looking at". "Viewing as someone, we are not sure who" is worse than no
// ribbon, because it claims a session is active and refuses to say whose.
//
// That is what the second assertion pins, and it is the only place that would
// notice a `= ""` appearing on the backend model.
// ---------------------------------------------------------------------------

export type ViewAsSessionIsClosed = Assert<IsClosed<ViewAsSessionResponse>>
export type ViewAsSessionEntryIsClosed = Assert<IsClosed<ViewAsSessionEntry>>
export type ViewAsSessionNamesBothAccounts = Assert<
  ViewAsSessionResponse extends {
    accessToken: string
    subjectEmail: string
    actorEmail: string
  }
    ? true
    : false
>
