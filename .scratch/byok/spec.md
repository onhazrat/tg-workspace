# Spec: Bring your own key

**Status:** done (BYOK-01 through BYOK-04; all six plan steps shipped 2026-09-09)

Implements [ADR-016](../../docs/migration/ADR-016-bring-your-own-key.md) and
[ADR-017](../../docs/migration/ADR-017-spend-session.md), settled 2026-09-08. Vocabulary is
`CONTEXT.md` under **AI access**; sequencing is `docs/byok-plan.md`. Those documents hold the
argument. This one holds the work.

## Problem Statement

Every AI call in the deployment is paid for by one key, read from the environment and belonging
to the Operator. That was right while a deployment was one person. It is not right now that
registration is a supported path and the tenancy seam is on.

An Account signs up, opens the Action tab, and starts spending the Operator's money. There is no
ledger, no ceiling and no signal. The Telegram side of the same problem has all three: Requests
are counted per Account per day, a Budget over its allowance drops to a slower lane, and past the
ceiling nothing runs. The AI side has nothing at all, and AI calls are the expensive ones.

The Operator's only lever today is not running a public deployment.

There is a second complaint underneath the first. The deployment speaks to exactly one Provider,
and the model list is three Gemini ids hardcoded in the backend and hardcoded again in the
frontend. An Account that would rather use a different model, a cheaper one, a local one, or one
its employer already pays for, cannot. The `LLMProvider` protocol was built for a second Provider
and never got one.

## Solution

An Account brings its own **AI Key** and its Artifacts are charged to it.

Which calls that covers is not a preference, it is a rule taken from the glossary: **an Artifact
is paid for by the Account that asked for it, everything else is paid for by the deployment.**
`CONTEXT.md` already defines an Artifact as a durable output somebody *deliberately asked for*,
and already uses that clause to exclude Logs, Sync jobs and Embeddings. Translation and the
query-embedding inside a Semantic chat fall on the excluded side by the same clause, unwidened.

So a Summary, a Chat and a Tag run are charged to the Account's AI Key. Corpus Embeddings,
Translations and the query-embedding that Semantic chat retrieves with are charged to the
**Operator Key**. One Semantic chat spends both, which is correct: the retrieval reads a shared
corpus and the completion is the Account's own output.

The data model forces the shared half. The Embedding and Translation tables are `FOLLOW_SCOPED`,
one row per Post shared by every Account that Follows the Channel, so two Accounts on different
Providers would overwrite each other with vectors from incompatible spaces and Semantic chat
would return plausible nonsense rather than an error. The translation job has no Account at all.

An AI Key names a **Provider**, of which there are two kinds and only two: Gemini, and anything
OpenAI-compatible at a base URL. The second kind is one thing, not a family, and it is what makes
"any Provider they like" true rather than aspirational.

Finally, an Owner supporting somebody now needs a way to reproduce a broken Summary without
either seeing that Account's Key or being unable to run anything. That is the **Spend session**,
a third View-as tier that grants use without sight.

## User Stories

**Holding a Key**

1. As an Account, I want to save an AI Key with a label, so that I can tell my work key from my personal one at a glance.
2. As an Account, I want to choose whether a Key is Gemini or OpenAI-compatible, so that the deployment talks to my Provider correctly.
3. As an Account, I want to give an OpenAI-compatible Key a base URL, so that I can point it at OpenRouter, Groq, Together, DeepSeek, a local Ollama or anything else that speaks that API.
4. As an Account, I want my Key verified when I save it, so that I find out it is wrong while I am looking at the form rather than three days later inside a scheduled Summary.
5. As an Account, I want to hold several Keys at once, so that I can keep a cheap Provider and an expensive one and choose between them per Artifact.
6. As an Account, I want to edit a Key's label and base URL without re-entering the secret, so that fixing a typo does not mean fetching the key out of my password manager.
7. As an Account, I want to delete a Key, so that revoking it at the Provider and removing it here are one decision.
8. As an Account, I want my Key never shown back to me after saving, so that a shoulder-surfer or a screen recording cannot lift it.
9. As an Account, I want my Key encrypted at rest, so that a database dump does not hand out my Provider account.
10. As an Account, I want a Key that the Provider has started rejecting to be flagged in the settings surface, so that I can tell a broken Key from a broken feature.

**Making Artifacts**

11. As an Account, I want to choose which Key pays for a Summary at the moment I ask for it, so that a long expensive run and a quick cheap one do not need me to change a setting in between.
12. As an Account with exactly one Key, I want no Key chooser at all, so that the common case has no extra step.
13. As an Account, I want the Key I used last to be pre-selected, so that a run of similar Artifacts does not mean the same choice over and over.
14. As an Account, I want to pick any model my Provider offers rather than three hardcoded Gemini ids, so that a Key reaching several hundred models is actually usable.
15. As an Account on an OpenRouter-shaped Key, I want the model list fetched from my Provider, so that I do not have to remember or retype exact model ids.
16. As an Account whose Provider serves no model list, I want to type a model id directly, so that an unusual endpoint is not excluded.
17. As an Account, I want the same Key and model choice available for a Chat and a Tag run as for a Summary, so that the three Artifact kinds behave alike.
18. As an Account, I want a Semantic chat to work without my Key having an embedding model, so that retrieval over the shared corpus is not my problem to configure.
19. As an Account with no Key at all, I want to be told to add one rather than shown a generic failure, so that the first thing I try tells me what to do.
20. As an Account whose Key the Provider rejected, I want a different message from the one meaning "you have no Key", so that I do not go hunting for a Key I already saved.
21. As an Account, I want a failed AI call recorded in my logs with its Provider and its error, so that I can tell whether the Provider or the deployment failed me.

**Scheduled work**

22. As an Account, I want a Summary set to auto-regenerate to remember which Key it uses, so that unattended work does not need me present to choose.
23. As an Account, I want a scheduled Summary whose Key stopped working to fail loudly and leave a log row, so that I discover it from the History rather than from silence.
24. As an Account, I want a scheduled Summary to keep its schedule after a failed run, so that one bad night does not quietly switch the feature off.
25. As an Account, I want a Summary that names another Account's Key to be refused, so that a hand-edited request cannot make somebody else pay for my work.

**Being the Operator**

26. As an Operator, I want Accounts to pay for their own Artifacts, so that opening registration does not open my Provider bill.
27. As an Operator, I want to keep paying for Embeddings and Translations, so that the shared corpus stays coherent and searchable for everybody.
28. As an Operator, I want the split between the two Keys to be a stated rule rather than a list, so that an AI call added next quarter is classified rather than forgotten.
29. As an Operator, I want no configuration switch that makes my Key pay for Artifacts, so that the expensive default cannot be turned back on by accident.
30. As an Operator, I want an Account's Keys omitted from every export, so that a support export is not a credential leak.

**Supporting somebody**

31. As an Owner, I want to reproduce a target Account's broken Summary, so that I can diagnose it instead of asking them to describe it.
32. As an Owner, I want that ability to be its own session tier, so that ordinary read-only and elevated sessions cannot spend anything by accident.
33. As an Owner, I want a Spend session to be shorter-lived than an elevated one, so that the most dangerous tier is also the most fleeting.
34. As an Owner, I want to never see a target's Key even at the highest tier, so that the tier cannot be used to exfiltrate credentials.
35. As an Owner, I want each AI call I make on somebody's behalf attributed to me, so that the record says who spent it.
36. As an Account, I want to see which Owner spent my Key and when, so that use on my behalf is visible to me afterwards.
37. As an Operator, I want a Permission of its own for spending, so that a role that views and writes but never spends is expressible without a code change.

**Not losing the secret**

38. As an Account, I want my Key never written to a log row, so that reading my own logs does not expose it and neither does an export of them.
39. As an Account, I want the request bodies recorded for my AI calls to carry the prompt and not the credential, so that debugging and secrecy are not in tension.

## Implementation Decisions

### One seam answers who pays

Every AI call passes a single resolution function that answers which Key pays, and that function
is where the rule lives. It is the shape `lane_for_job` already has for enqueueing and
`resolve_charge_owner` has for Requests: one function, one answer, no second copy.

From the seam sketch agreed with the developer:

```
resolve_ai_key(session, *, user_id, purpose)
    purpose in { summary, chat, tag }              -> the Account's AI Key
    purpose in { embed, translate, rag_query }     -> the Operator Key

AI_KEY_CALLERS = a declared list, walked from the AST
```

The purpose enum is the rule made total. Adding a seventh purpose means classifying it, and the
declared caller list means a twelfth AI call site that bypasses the seam fails a guard rather
than silently charging the deployment. This follows the declared-caller pattern already used for
the two paths that sync without enqueueing.

### The Key is a row, modelled on the bot credential

A new user-owned table holds many Keys per Account: owner, label, Provider kind, base URL,
encrypted secret, last-validated timestamp. It reuses the deployment's existing Fernet encryption
and its environment key rather than introducing a second scheme, and it copies the bot credential
table's shape closely enough that the two can share their tenancy guard.

A new aggregate service module is the table's sole writer and declares itself as such. The Key's
plaintext is returned by no route, ever.

The table is classified as user-owned in the tenancy seam, appears on the owner inventory, is
truncated between tests, is pruned by no retention window, and is **omitted** from export with a
stated reason.

### The model does not live on the Key

One OpenRouter Key reaches several hundred models, so a default-model-per-Key is wrong-shaped for
the case that motivates the feature. The model stays where it already is, on the wire per call.

The existing models endpoint survives but changes meaning: instead of serving a static list, it
proxies the named Key's Provider for its model list, cached per Key, and falls back to free text
where a Provider serves none. The two hardcoded model lists, one in the backend and one in the
frontend, are deleted. Because this endpoint now makes an outbound call on an Account's behalf,
it is a spending operation and not a read, which excludes it from the View-as read-only
allowlist.

### The second Provider is one class

`OpenAICompatibleProvider` implements the existing protocol and takes a base URL. There is no
class per vendor. The existing Gemini provider is unchanged except for taking its credential as
an argument rather than reading the environment.

The provider registry currently caches instances in a module-level dictionary keyed by provider
name alone. With per-Account Keys that hands one Account another Account's client. The cache is
keyed by credential or removed.

### The unattended path stores its choice, and re-checks it

A Summary's open metadata bag gains the id of the Key its scheduled regeneration should use,
sitting beside the publish bot and chat ids already there.

That bag is filled from unrecognised keys in the request body, so the Key id is **client-supplied
and untrusted**. Multi-user-tenancy ticket 33 found that resolving the publish bot id by primary key alone let a
Summary name another Account's credential, which the scheduler then decrypted and sent with. The
AI Key must be re-checked against the Summary's owner **before** the secret is decrypted, in the
same place and for the same reason. A refusal files a failed log row rather than returning
quietly, because the scheduler is unattended.

### Two failures, two answers

"You have no Key" and "your Key was rejected" are different problems with different fixes, and
today they would both be the single status the environment-key check answers. They get distinct
statuses so the client can say the right thing. A rejection also clears the Key's validation
state, which is the signal the settings surface reads. Nothing re-validates on a schedule: a job
that spends people's money to check whether they can still spend money is the cost this feature
exists to remove.

A rejected Key never disables a schedule. Auto-disabling on one failure loses work quietly.

### The log records the call, not the credential

The LLM log gains the Provider kind and the base URL as columns beside the model it already
carries, denormalised with no foreign key so a row stays readable after its Key is deleted. It
also gains the acting-Owner pair that all four Artifact families already carry and it does not,
which matters because a spend that fails produces no Artifact to carry the attribution.

Key material is never logged. The recorded request body is composed at each call site rather than
dumped from the outgoing HTTP request, which is the only reason nothing can capture an auth
header today. The new Provider inherits that, with a guard, because the obvious implementation
logs what it sent and one supported Provider accepts its credential as a URL query parameter.

### The Spend session

A third View-as mode joins read-only and elevated. It grants use of a target Account's paid
resources, defined as a category with a derived inventory rather than as a list, so a fourth
spendable resource added later fails a guard until classified. It grants no sight: the Key routes
stay refused at every tier, alongside the View-as routes and the credential routes that are
already refused however a session was elevated.

It is granted on Operator authority alone with no target consent. This is deliberate and argued
in ADR-017: an elevated Owner already spends a target's Telegram Budget with no consent step, so
gating AI alone would be a control in one place and not the other. It is a third exchange
authorised by the Owner's own token so a session cannot widen itself, with its own ceiling
validated strictly shorter than the elevated ceiling.

It gets its own Permission constant, because authorisation here names a Permission and never a
role, and Permissions are code while roles are data.

### The frontend

A Keys panel in settings, mirroring the bot credentials panel. A Key selector in the Action tab,
hidden when an Account has one Key, with the last used remembered in the Account-namespaced
browser storage rather than in a settings row or on the server. Model selection becomes a combo
of the fetched list and free text.

## Testing Decisions

A good test here asserts external behaviour: which Key paid, what an Account can see, what a
request answers. It does not assert that a particular function was called or that a module has a
particular shape. Where this codebase's guards do read structure, they read it from the AST to
enforce an inventory that must stay complete, which is a different thing from pinning an
implementation.

**One new seam, one new test module.** `resolve_ai_key` is the single place the payment rule
lives, and a new module in the services tests asserts the whole rule against it: each Artifact
purpose resolves the requesting Account's Key; each shared purpose resolves the Operator Key; a
Key id belonging to another Account is refused before the secret is decrypted; and a caller not
on the declared list fails the guard. The prior art is the lane-selection tests, which assert
that the real enqueue path picks the lane rather than testing the pure function in isolation, and
which hold the declared-caller list for the two paths that sync without enqueueing.

**Four existing guards are extended rather than duplicated.**

The credential tenancy test is **parametrised over both credential kinds** rather than copied.
This repo has already paid for the alternative: two image-cache modules were the same module
twice, one was fixed and the other kept the defect for two months and turned a channel list into
thirty seconds. Its guard is parametrised over both for that reason, and this is the same
situation caught earlier. When you fix one of a pair, guard the pair.

The account-isolation test probes every mounted operation with two live Accounts; the new routes
join it, either probed or excused with a typed reason.

The View-as tests walk every mutating operation against every tier. They gain a third tier, and
the elevation test's existing assertion that every artifact family stamps the acting Owner
extends to cover the LLM log.

The service-kinds test requires the new module to declare its kind.

**Guards that fire without being written.** The export coverage test forces the new table into
either the export inventory or the omissions list. The owner-backfill test derives its table list
from the tenancy scopes. The retention test derives its inventories the same way, and the new
table belongs to neither, as the quota ledger does not. The route hygiene test rejects a model
declared inside a route module. The client generation hook fails on a stale generated client.

**Mutation-test every new guard before trusting it.** A green suite proves nothing until it has
been watched going red. Six false passes were caught this way during the simplification
programme, one of them a guard that could not fail at all.

**What is not worth a test.** The Provider classes themselves are integration code against
somebody else's API; the seam that matters is which credential they were handed, and that is
covered above. Pinning request-body shapes against a vendor's API teaches the suite a vendor's
current behaviour, not ours.

## Out of Scope

**Per-Account embeddings.** An Account cannot keep its Posts away from the Operator's embedding
Provider. Doing so means keying the largest table in the deployment per Account, against a corpus
of roughly 4.68M Posts, for vectors that would be near-identical wherever two Accounts chose the
same Provider. If privacy rather than cost becomes the driver, ADR-016 is the thing to reopen and
this is where it goes.

**An AI spend ledger.** No analogue of the Request quota exists for AI: no per-Account daily
counter, no allowance, no ceiling, no lane. Under BYOK the Account is billed by its own Provider,
which is the enforcement. The token count per call is already recorded if a surface ever wants it.

**A first-party Anthropic Provider.** Reachable through any OpenAI-compatible gateway today. A
native client is a later call.

**Consent for Spend sessions.** Rejected in ADR-017, with the reasoning recorded there. If it is
revisited, all three spendable resources move together; consent for AI alone is the outcome to
avoid.

**Moving the Operator Key into the Keys table.** It stays in the environment because it is
deployment policy, like every other setting of its kind.

**Any change to the Request quota, the lanes, or the ceilings.** The Telegram Budget is untouched
by this work except that a Spend session can now consume it, which ADR-017 covers.

## Further Notes

Two defects surfaced during design that are not caused by this feature but become live the moment
it ships, and both are named in the implementation decisions above rather than left as folklore:
the provider registry's cache keyed by name alone, and the absence of any guard stopping a
credential from reaching a logged request body.

The work splits into six steps in `docs/byok-plan.md`, sequenced so each lands green on its own.
Steps 1 to 4 are the feature. Steps 5 and 6 are ADR-017 and can be deferred without blocking it,
though step 5's acting-Owner columns are what make step 6 accountable, so they should not be
separated from each other.
