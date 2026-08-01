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
 * Each assertion says: *every field the server declares must remain assignable
 * to the field we declare*. Rename `postsCount`, retype `timestamp` as a string,
 * or drop a column, and the corresponding line stops compiling.
 *
 * The reverse is deliberately **not** checked. Our types carry fields the server
 * does not declare — the group-inherited channel settings and the summary UI
 * flags travel through the open model's `extra` — and demanding the server
 * declare those would defeat the open-model design they depend on.
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
 * noise, not drift. Renames, retypes and removals are still caught.
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

// --- Enforced ----------------------------------------------------------------
// These compile only while the server's declared fields stay assignable to ours.

export type SummaryConforms = NoMismatches<
  MismatchedServerFields<SummaryResponse, Summary>
>
export type SettingGroupConforms = NoMismatches<
  MismatchedServerFields<SettingGroupResponse, ChannelSettingGroup>
>

// --- Known mismatches, deliberately not yet enforced (B7b) -------------------
//
// Turning these into `NoMismatches<…>` is the follow-up unit. Each is a real
// divergence the check found, not noise — but fixing them means widening the
// hand-written types to the server's looser reality and then chasing the call
// sites that relied on the narrower one, which is its own change.
//
// They are exported as the *mismatch set* rather than deleted so the finding
// lives in the code: hover one in an editor and it names the offending fields.

/** `status` is `string` server-side; we narrow it to `"success" | "failed"`. */
export type NetworkLogMismatches = MismatchedServerFields<
  NetworkLogResponse,
  NetworkLog
>
/** Same `status` narrowing, plus the loose JSON payload columns. */
export type LLMLogMismatches = MismatchedServerFields<LLMLogResponse, LLMLog>
/** `media` / `links` / `replyTo` are `unknown` server-side — see `types.ts`. */
export type PostMismatches = MismatchedServerFields<PostResponse, Post>
/** Group-inherited fields arrive through `extra` and are untyped server-side. */
export type ChannelMismatches = MismatchedServerFields<ChannelResponse, Channel>
