# #20 ⬆️ Upgrade zod to v4

**State:** merged 2026-07-25 · **Branch:** `pr5/zod-v4` into `main` · **Diff:** +9 / -11 across 5 files · **Opened:** 2026-07-25

---

PR 5 of 7. Based on `main` (PRs 1–4 are merged).

Matches the upstream template's `zod ^4.4.3`. **The break was confined to a single file**, despite 11 modules importing zod.

## What actually broke

zod v4 removes the `ZodTypeDef` type and reduces `ZodType` to a single type parameter, so `routes/login.tsx`'s

```ts
}) satisfies z.ZodType<AccessToken, z.ZodTypeDef, AccessToken>
```

no longer compiles. It becomes `satisfies z.ZodType<AccessToken>` — exactly the form upstream uses.

`z.string().email()` is superseded by the top-level `z.email()` in v4; applied at the three call sites (`login`, `signup`, `recover-password`), again matching upstream.

## What didn't break

`lib/settings/schema.ts` — the heaviest zod consumer in the codebase and the thing I expected to be the real cost here — needed **no changes at all**.

A sweep for the other common v3-only APIs (`z.string().url()`, `z.string().uuid()`, `.deepPartial()`, `z.nativeEnum`, `errorMap`, `invalid_type_error`, `required_error`) found no remaining uses.

`@hookform/resolvers` 5.4.0 peer-depends only on `react-hook-form`, not on zod, so there's no peer conflict.

## Verification

- `bunx tsc -p tsconfig.build.json --noEmit` — clean
- `biome check` — clean
- `bun test src` — **482 passed, 0 failed** across 67 files
- `bun run build` — succeeds

🤖 Generated with [Claude Code](https://claude.com/claude-code)
