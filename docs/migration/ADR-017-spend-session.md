# ADR-017: A third View-as tier that spends without seeing

**Status:** Accepted (2026-09-08). Extends the View-as design and its elevation exchange.
Depends on [ADR-016](./ADR-016-bring-your-own-key.md), which gives an Account something worth
spending.

## Context

View-as has two tiers. A read-only session refuses every non-safe method minus
`VIEW_AS_READ_ONLY_PATHS`, whose bar is stated in `api/deps.py` and is deliberately narrow: reads
a row, writes none, reaches no external service, spends no Budget. `POST /rag/search` is refused
by that last clause although it looks like a read, because it calls an embedding Provider. An
elevated session is a second exchange authorised by the Owner's own token, ceilinged at 15
minutes against the read-only session's 30, refused outright for a target holding any Permission,
and every row it writes is stamped `acted_by_user_id`/`acted_by_email`.

ADR-016 gives each Account an AI Key. That makes a support request the existing tiers cannot
serve: an Owner is asked to look at why somebody's Summary comes out wrong, and cannot regenerate
it, because regenerating spends the target's money and elevation was never meant to authorise
that.

The tempting answer is to widen elevation. It is wrong for a reason worth writing down: elevation
authorises *writes*, and every write it authorises is reversible and attributed. Spending is
neither. Money leaves and no `acted_by_*` stamp brings it back.

The second tempting answer, which this ADR considered and rejected, is to require the target
Account's recorded consent before an Owner may spend. It was rejected on a fact about the system
as it already is: `resolve_charge_owner` charges Telegram Requests to the token's subject, which
under View-as is the **target**. An elevated Owner already spends the target's Telegram Budget
today, with no consent step and no ADR. Adding a consent gate for AI while that stands would be a
control in one place and not the other, which reads as a policy but functions as an
inconsistency.

## Decision

A third View-as tier, `spend`, joining `read_only` and `elevated` in `VIEW_AS_MODES`.

**What it grants.** Use of the target Account's paid resources: its AI Key, its bot credentials,
its Telegram Budget. Defined as a category rather than a list, with an inventory a guard derives —
the shape `VIEW_AS_READ_ONLY_PATHS` already uses, and for the same reason. A fourth spendable
resource added next quarter must fail the guard until somebody has answered "does this spend?".
Three independent switches, one per resource, was rejected: nobody reasons about three switches
correctly under pressure, which is the only time this tier gets used.

**What it never grants.** Sight. No tier reads key material back. `/ai-keys` stays refused in all
three tiers exactly as the `/users/me` credential routes already are, and the answer to "is this
Key working" is its validation state, not its plaintext. `publish_summary_text` sets the pattern:
it refuses a foreign credential *before* `decrypt_token`. Use without sight is the whole design,
and a support tier that can read secrets is a credential-exfiltration route with a business
justification attached.

**How it is granted.** On Operator authority alone, no target consent, as a third exchange
authorised by the Owner's own token so a session can never widen itself. Its own ceiling setting,
validated strictly shorter than `VIEW_AS_ELEVATED_MAX_MINUTES` the way that one is validated
strictly shorter than `VIEW_AS_TOKEN_EXPIRE_MINUTES`.

**A Permission of its own,** `Permission.VIEW_AS_SPEND`. Authorisation here names a Permission and
never a role, and Permissions are code while roles are data, so a new capability is a new
constant. This makes a role that views and writes but never spends expressible as an `INSERT`
rather than as a code change.

**Attribution reaches the call, not only its output.** `LLMLog` gains
`acted_by_user_id`/`acted_by_email`, which it lacks today although all four Artifact families
carry the pair. Without it a spend that fails leaves no attributed trace anywhere: the money is
gone and there is no Artifact to carry the stamp. With no consent gate, the target's ability to
see what was spent on their behalf is the entire compensating control, so it has to cover the
failed call as well as the successful one.

## Why not consent

Recorded in full because it was the closest call in the design.

Consent is the stronger control and this ADR does not pretend otherwise. It was rejected because
the system already spends a target's Telegram Budget under elevation with no consent, so a gate on
AI alone would protect one resource and not the other while appearing to protect both. Adding
consent to *all three* resources is the coherent version of that argument, and it is a larger
change than this ADR: it means a consent record, a request flow, an expiry, and a story for what
an Operator does when a target never answers.

If this is revisited, revisit it whole. Consent for AI alone is the outcome to avoid.

## Consequences

An Owner with the Permission can spend any target's money for the duration of a short session,
and the target learns about it afterwards rather than agreeing to it beforehand. That is the
accepted cost, and it is why the ceiling is the shortest of the three and why the attribution
reaches `LLMLog`.

`view_as_allows` stays the one function that answers whether an operation is permitted, now over
three modes rather than two. Its guard walks every mounted mutating operation, so a route added
later cannot join the API without somebody classifying it against all three.

The refusal set grows rather than shrinks. `/view-as/*`, the `/users/me` credential routes and now
`/ai-keys` stay refused however the session was elevated, including at this tier.

`GET /api/v1/ai/models` reaches an external Provider under ADR-016, so it is a spend-tier
operation, not a read. This is the second time the `deps.py` bar has caught a route that looks
like a read and is not; `POST /rag/search` was the first.

## What this does not decide

Whether a target can see spend sessions against their own Account in a surface of their own, as
opposed to reading the attribution on the rows. `view_as_sessions` records who, whom and when
already.

Whether the tier ever becomes consent-gated. See above: if it does, all three resources move
together.

Whether an Operator can spend the **Operator Key** on a target's behalf, which would sidestep this
tier entirely for the AI case. Under ADR-016 the Operator Key pays for no Artifact, so the
question does not arise yet.
