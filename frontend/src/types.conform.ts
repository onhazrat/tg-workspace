/**
 * Compile-time conformance between the hand-written domain types and the server.
 *
 * **This is a source file, not a test file, on purpose.**
 * `tsconfig.build.json` excludes `src/**\/*.test.*`, so assertions placed in a
 * test would never be type-checked by `bun run build` or the typecheck command —
 * they would compile-and-pass no matter what the server did. Living here, they
 * are checked on every build.
 *
 * ## Why these six are not simply re-exported
 *
 * B7 rebased nine domain types onto their generated counterparts, so those
 * cannot drift — the compiler enforces it directly. Six could not be: `Post`,
 * `Channel`, `Summary`, `ChannelSettingGroup`, `LLMLog` and `NetworkLog` have
 * **open** response models, which OpenAPI renders as a top-level
 * `[key: string]: unknown`.
 *
 * Basing a type on one is actively harmful downstream: `Omit<T, K>` over a type
 * carrying an index signature collapses every named property into that
 * signature, so `SummaryListItem = Omit<Summary, …>` would degrade every field
 * to `unknown`. Rebasing all fifteen produced **190 type errors**, almost all of
 * that shape.
 *
 * ## What is and is not checked
 *
 * Three assertions per model, because one direction is not enough:
 *
 * 1. **`…Conforms`** — every field the server declares stays assignable to ours.
 *    Catches a *retype*: `timestamp` becoming a string.
 * 2. **`…RefinementsHold`** — every field we deliberately narrow stays a subtype
 *    of the server's. Catches a retype under a narrowing, which (1) cannot see.
 * 3. **`…HasServerFields`** — the load-bearing columns are still *declared*.
 *    Catches a **rename or a drop**, which neither of the others can see.
 *
 * **(3) exists because (1) silently ignored both.** `MismatchedServerFields`
 * iterates the *intersection* of the two key sets, so a field the server drops
 * or renames simply leaves the intersection and stops being checked. This file
 * previously claimed in this very docstring that a rename "stops compiling"; it
 * did not, and a mutation test renaming a field compiled clean. The same shape
 * of hole as B7's first draft, which could not fail at all.
 *
 * (3) is an explicit allowlist rather than "every field of ours", because our
 * types legitimately carry fields the server does not declare — the
 * group-inherited channel settings and the summary UI flags travel through the
 * open model's `extra`, and demanding the server declare those would defeat the
 * open-model design they depend on.
 *
 * ## What is still not checked, and cannot be
 *
 * Widening *our* type for a field the server leaves as untyped JSON. If the
 * server says `media?: {[key: string]: unknown}`, it contributes no information
 * to validate `PostMedia` against — any object shape satisfies it. That is a
 * property of the loose column, not a gap in the guard; the only fix would be
 * declaring the nested model server-side, which `schemas/posts.py` documents at
 * length why it must not.
 */

import type {
  ChannelResponse,
  LLMLogResponse,
  NetworkLogResponse,
  PostResponse,
  SettingGroupResponse,
  SummaryResponse,
} from "@/client"
import type {
  Channel,
  ChannelSettingGroup,
  LLMLog,
  NetworkLog,
  Post,
  Summary,
} from "@/types"

/**
 * The union of field names whose server type is no longer assignable to ours,
 * or `never` when every shared field still lines up.
 *
 * The obvious formulation — mapping each field to `true | never` and constraining
 * the result to `Record<string, true>` — **cannot fail**, because `never` is
 * assignable to every type. A first draft of this file did exactly that and both
 * mutation tests passed against it. Collecting the offending *keys* is what makes
 * the assertion have teeth.
 *
 * `DeclaredKeys` strips the index signature first. Without it, an open model's
 * `[key: string]: unknown` puts `string` itself into `keyof`, `Server[string]`
 * is `unknown`, and *every* comparison fails — all six assertions reported a
 * mismatch of `string` before this was added. The index signature is the same
 * thing that made rebasing these six impossible.
 *
 * Both sides are `NonNullable`-normalised, so this compares the *underlying*
 * type and not its nullability. That is deliberate: OpenAPI cannot express
 * "has a server-side default, therefore always present in a response", so a
 * field like `timestamp: int = 0` is emitted as `timestamp?: number` and a
 * nullable column as `error?: string | null`. Comparing those raw would flag
 * every optional field on every model — it did, on the first attempt — which is
 * noise, not drift. Retypes are still caught; renames and removals are **not**,
 * and are the job of `MissingServerFields` below.
 */
type DeclaredKeys<T> = {
  [K in keyof T as string extends K ? never : K]: T[K]
}

type MismatchedServerFields<
  Server,
  Ours,
  Shared extends keyof Server & keyof Ours = keyof DeclaredKeys<Server> &
    keyof Ours,
> = {
  [K in Shared]: NonNullable<Server[K]> extends NonNullable<Ours[K]> ? never : K
}[Shared]

/**
 * Accepts only `never`. A non-empty union of field names fails to satisfy the
 * constraint, and the error names the offending fields.
 */
type NoMismatches<_T extends never> = true

/**
 * The same comparison in the **opposite** direction: every listed field's type
 * must be a *subtype* of what the server declares.
 *
 * ## Why a second direction exists at all (B7b)
 *
 * The plan called B7b "enforce the four remaining conformance checks", on the
 * assumption they were unfinished work. Enumerating them showed they are not.
 * All eight offending fields are places where **our type is deliberately
 * narrower than the server's**, in one of exactly two ways:
 *
 * | | server | ours |
 * |---|---|---|
 * | `LLMLog.status`, `NetworkLog.status` | `string` | `"success" \| "failed"` |
 * | `LLMLog.type` | `string` | four known kinds |
 * | `Post.retrievalPass` | `string \| null` | `"initial" \| "incremental"` |
 * | `Post.media`, `Post.links` | untyped JSON | `PostMedia`, `PostBodyLink[]` |
 * | `Channel.tags`, `Channel.discoveredVia` | untyped JSON | shaped |
 *
 * Neither kind is drift, and neither is fixable in the original direction —
 * `NonNullable<Server[K]> extends NonNullable<Ours[K]>` asks the *server* to
 * declare a literal union it deliberately does not, or a nested model that
 * `schemas/posts.py` documents at length why it must not (declaring it would
 * change the wire format, because `to_storage_dict()` uses `exclude_none=True`).
 *
 * Widening our types to match would have been the mechanical reading of the
 * plan, and it would have **thrown away real knowledge** — the four log-status
 * narrowings are what let a `switch` be exhaustive. So the fix is not to widen,
 * it is to check the narrowings in the direction that is actually true of them.
 *
 * What this still catches: the server retyping `status` to a number, renaming
 * a JSON column, or changing `media` to something a `PostMedia` is not.
 */
type BadRefinements<Server, Ours, Refined extends keyof Server & keyof Ours> = {
  [K in Refined]: NonNullable<Ours[K]> extends NonNullable<Server[K]>
    ? never
    : K
}[Refined]

/** Fields checked as refinements are exempt from the server→ours direction. */
type UnrefinedMismatches<Server, Ours, Refined extends PropertyKey> = Exclude<
  MismatchedServerFields<Server, Ours>,
  Refined
>

/**
 * Names the server must still *declare*, or `never`.
 *
 * The rename/drop check. `MismatchedServerFields` compares only the keys the
 * two sides share, so a dropped or renamed column leaves the comparison rather
 * than failing it — silently, and the guard reads as green.
 *
 * Deliberately an explicit allowlist of the columns the UI cannot function
 * without, not "everything we declare": our types carry `extra`-borne fields
 * the server never declares, and requiring those would make this fail always.
 * Adding a field here is a claim that the server owns it.
 */
type MissingServerFields<Server, Required extends PropertyKey> = Exclude<
  Required,
  keyof DeclaredKeys<Server>
>

// --- Enforced ----------------------------------------------------------------
// Every one of the six compiles only while the server's declared fields stay
// assignable to ours — except for the fields named as deliberate refinements,
// which are checked the other way round instead of being skipped.

export type SummaryConforms = NoMismatches<
  MismatchedServerFields<SummaryResponse, Summary>
>
export type SettingGroupConforms = NoMismatches<
  MismatchedServerFields<SettingGroupResponse, ChannelSettingGroup>
>

/** `status` is a free `string` server-side; the client writes only two values. */
type NetworkLogRefined = "status"
export type NetworkLogConforms = NoMismatches<
  UnrefinedMismatches<NetworkLogResponse, NetworkLog, NetworkLogRefined>
>
export type NetworkLogRefinementsHold = NoMismatches<
  BadRefinements<NetworkLogResponse, NetworkLog, NetworkLogRefined>
>

/** Same `status` narrowing, plus `type`'s four known prompt kinds. */
type LLMLogRefined = "status" | "type"
export type LLMLogConforms = NoMismatches<
  UnrefinedMismatches<LLMLogResponse, LLMLog, LLMLogRefined>
>
export type LLMLogRefinementsHold = NoMismatches<
  BadRefinements<LLMLogResponse, LLMLog, LLMLogRefined>
>

/** Two JSON columns kept loose server-side (see `schemas/posts.py`), plus an enum. */
type PostRefined = "media" | "links" | "retrievalPass"
export type PostConforms = NoMismatches<
  UnrefinedMismatches<PostResponse, Post, PostRefined>
>
export type PostRefinementsHold = NoMismatches<
  BadRefinements<PostResponse, Post, PostRefined>
>

/** Two more loose JSON columns. */
type ChannelRefined = "tags" | "discoveredVia"
export type ChannelConforms = NoMismatches<
  UnrefinedMismatches<ChannelResponse, Channel, ChannelRefined>
>
export type ChannelRefinementsHold = NoMismatches<
  BadRefinements<ChannelResponse, Channel, ChannelRefined>
>

// --- Rename / drop guards ----------------------------------------------------
//
// The columns each view genuinely cannot render without. If the server stops
// declaring one, these stop compiling — which the assignability checks above do
// not do, because they only compare keys the two sides share.

export type SummaryHasServerFields = NoMismatches<
  MissingServerFields<SummaryResponse, "id" | "text" | "timestamp" | "channels">
>
export type SettingGroupHasServerFields = NoMismatches<
  MissingServerFields<SettingGroupResponse, "id" | "name">
>
export type NetworkLogHasServerFields = NoMismatches<
  MissingServerFields<NetworkLogResponse, "id" | "status" | "timestamp" | "url">
>
export type LLMLogHasServerFields = NoMismatches<
  MissingServerFields<
    LLMLogResponse,
    "id" | "status" | "timestamp" | "model" | "prompt" | "response"
  >
>
export type PostHasServerFields = NoMismatches<
  MissingServerFields<
    PostResponse,
    "id" | "channelName" | "text" | "timestamp" | "date"
  >
>
export type ChannelHasServerFields = NoMismatches<
  MissingServerFields<ChannelResponse, "id" | "name" | "startTime">
>
