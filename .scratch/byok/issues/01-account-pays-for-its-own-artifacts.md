# 01: An Account saves an AI Key and pays for its own Artifacts

**What to build:** An Account can save an AI Key in settings, and from then on its Summaries,
Chats and Tag runs are paid for by that Key instead of by the Operator. Corpus Embeddings,
Translations and the query-embedding inside a Semantic chat keep running on the Operator Key,
because those produce shared rows and are not Artifacts.

Gemini only in this ticket. The second Provider kind is ticket 02, which is why the Key still
needs a Provider field now rather than later.

An Account with no Key is told to add one. An Account whose Key the Provider rejected is told
something different, because those are different problems with different fixes and today they
would both be the single status the environment-key check answers.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

## The rule this ticket makes true

An Artifact is paid for by the Account that asked for it. Everything else is paid for by the
deployment. That is `CONTEXT.md`'s own Artifact definition, reused rather than restated: a
durable output somebody *deliberately asked for*, which is already the clause excluding Logs,
Sync jobs and Embeddings.

The rule lives in one function and nowhere else, the shape `lane_for_job` has for enqueueing and
`resolve_charge_owner` has for Requests. From the seam sketch agreed with the developer:

```
resolve_ai_key(session, *, user_id, purpose)
    purpose in { summary, chat, tag }              -> the Account's AI Key
    purpose in { embed, translate, rag_query }     -> the Operator Key

AI_KEY_CALLERS = a declared list, walked from the AST
```

All eleven existing AI call sites route through it in this ticket, including the three that
resolve to the Operator Key. Leaving those on the old path would make the seam a partial
inventory, which is the thing the declared caller list exists to prevent.

## Acceptance criteria

- [ ] A new user-owned table holds many Keys per Account: owner, label, Provider kind, base URL, encrypted secret, last-validated timestamp. It reuses the deployment's existing Fernet encryption and its environment key rather than a second scheme.
- [ ] A new aggregate service module is the table's sole writer and declares its kind.
- [ ] The table is classified in the tenancy seam as user-owned, appears on the owner inventory, is truncated between tests, is pruned by no retention window, and is omitted from export with a stated reason.
- [ ] The Key's plaintext is returned by no route. Editing a label or base URL does not require re-entering the secret.
- [ ] Saving a Key validates it with one cheap completion and records the result. Nothing re-validates on a schedule.
- [ ] `resolve_ai_key` exists with the six purposes above and a declared caller list walked from the AST. A call site not on the list fails a guard.
- [ ] All eleven AI call sites resolve their Key through the seam. The Gemini Provider takes its credential as an argument instead of reading the environment.
- [ ] The provider registry no longer caches instances keyed by Provider name alone. With per-Account Keys that cache hands one Account another Account's client.
- [ ] Summary, Chat and Tag run accept the Key id on the wire; the generated client is regenerated.
- [ ] An Account with no Key and an Account with a rejected Key get distinct statuses. A rejection clears the Key's validation state so the settings surface can flag it.
- [ ] A Key id naming another Account's row is refused before the secret is decrypted, and answers as an absent row does.
- [ ] Settings gains a Keys panel mirroring the bot credentials panel. The Action tab gains a Key selector, hidden when an Account holds exactly one Key, with the last used remembered in Account-namespaced browser storage.
- [ ] A new services test module asserts the whole rule: each Artifact purpose resolves the caller's Key, each shared purpose resolves the Operator Key, a foreign Key is refused before decrypt, an undeclared caller fails.
- [ ] The credential tenancy guard is **parametrised over both credential kinds** rather than copied. When you fix one of a pair, guard the pair.
- [ ] The new routes join the account-isolation probe, either probed or excused with a typed reason.
- [ ] Every new guard is mutation-tested. A green suite proves nothing until it has been watched going red.

## Notes

The Operator Key stays in the environment. It is deployment policy, like every other setting of
its kind, and moving it into the table is explicitly out of scope in the spec.

There is no fallback to the Operator Key for an Artifact, and no switch to enable one. A fallback
would make the default path the one where the Operator pays, which is the problem this feature
exists to solve.
