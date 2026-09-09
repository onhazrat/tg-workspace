# BYOK-04: The Spend session

**What to build:** An Owner helping somebody with a broken Summary can reproduce it, spending
that Account's AI Key, without ever seeing the Key.

Today the two View-as tiers cannot serve this. A read-only session refuses every non-safe method.
An elevated session authorises writes, and writes are reversible and attributed; spending is
neither. So this is a third tier rather than a widening of the second.

**Blocked by:** BYOK-03.

**Status:** done

## Use without sight

The tier grants use of a target Account's paid resources: its AI Key, its bot credentials, its
Telegram Budget. Defined as a **category with a derived inventory**, not a list, so a fourth
spendable resource added later fails a guard until somebody classifies it. That is the shape the
read-only path allowlist already has, and for the same reason.

It grants no sight at any tier. The Key routes stay refused however a session was elevated,
alongside the View-as routes and the credential routes already refused that way. The precedent is
the publish path, which refuses a foreign credential *before* it is decrypted.

## Acceptance criteria

- [x] A third View-as mode joins read-only and elevated, and the one function that answers whether an operation is permitted answers for all three.
- [x] It is a third exchange authorised by the Owner's own token, so a session can never widen itself.
- [x] It has its own ceiling, validated strictly shorter than the elevated ceiling, the way that one is validated strictly shorter than the read-only session.
- [x] It gets its own Permission constant. Authorisation here names a Permission and never a role, so a role that views and writes but never spends becomes expressible as data rather than a code change.
- [x] The Key routes are refused in all three tiers.
- [x] Every AI call made during the session is attributed to the acting Owner on the log row BYOK-03 added, and an ordinary write by the Account clears that attribution.
- [x] The guard that walks every mounted mutating operation now walks it against three tiers, so a route added later cannot join the API without being classified against all of them.
- [x] The models endpoint from BYOK-02, if that ticket has landed, is classified as spending rather than reading.

## Notes

Built against BYOK-02 while BYOK-03 was still in flight, then rebased onto it. The
`acted_by_user_id`/`acted_by_email` pair on `LLMLog` and the stamp in `upsert_llm_log` are
BYOK-03's (`f3a4b5c6d7e8`); this ticket is the tier that makes them load-bearing, and
`test_view_as_spend.py` asserts they hold under a spend token rather than re-adding them.

Granted on Operator authority alone, with no target consent. This is deliberate and argued in
ADR-017: an elevated Owner already spends a target's Telegram Budget with no consent step, so
gating AI alone would be a control in one place and not the other. If consent is ever revisited,
all three spendable resources move together. Consent for AI alone is the outcome to avoid.
