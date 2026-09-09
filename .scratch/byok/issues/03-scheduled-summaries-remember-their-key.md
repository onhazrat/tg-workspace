# BYOK-03: Scheduled Summaries remember their Key, and the log says who paid

**What to build:** A Summary set to auto-regenerate keeps working after BYOK-01, because it
remembers which Key pays for it. Nobody is present at 4am to choose one.

And when it stops working, the Account can find out why. A Key the Provider has started rejecting
produces a failed run that leaves a log row and flags the Key, without switching off the
schedule.

**Blocked by:** BYOK-01. Independent of BYOK-02.

**Status:** done

## The trap this ticket has to avoid

The Summary's open metadata bag already carries the publish bot and chat ids, and the Key id goes
beside them. That bag is filled from unrecognised keys in the request body, so the Key id is
**client-supplied and untrusted**.

Multi-user-tenancy ticket 33 found the same shape already exploited: resolving the publish bot id by primary key
alone let a Summary name another Account's credential, which the scheduler then decrypted and
sent with. The AI Key must be re-checked against the Summary's own owner **before** the secret is
decrypted, in the same place and for the same reason.

## Acceptance criteria

- [x] A Summary carries the id of the Key its scheduled regeneration should use, beside the publish ids it already holds.
- [x] Scheduled regeneration resolves that Key through the same seam an interactive request uses, and charges the Summary's own owner.
- [x] A Key id naming another Account's row is refused before the secret is decrypted, and the refusal files a failed log row rather than returning quietly. The scheduler is unattended; a silent return is invisible.
- [x] A rejected Key during a scheduled run files a failed log row and clears the Key's validation state.
- [x] A failed run does **not** disable the schedule. Auto-disabling on one failure loses work quietly.
- [x] The LLM log gains the Provider kind and the base URL as columns beside the model it already carries, denormalised with no foreign key so a row stays readable after its Key is deleted.
- [x] The LLM log gains the acting-Owner pair that all four Artifact families already carry and it does not. A spend that fails produces no Artifact, so without this the money is gone and nothing is attributed.
- [x] Key material never reaches a logged request body. The recorded body is composed at the call site rather than dumped from the outgoing HTTP request, and a guard asserts it, because one supported Provider accepts its credential as a URL query parameter.
- [x] The log list stays cheap. These are short strings on a row already being written, so they are columns and not a blob; the list-versus-detail split exists because that mistake cost a 56 MB page once.

## Notes

The acting-Owner columns are BYOK-04's accountability, which is why BYOK-04 is blocked by this
ticket rather than by 01. Shipping a tier that spends somebody's money before the attribution
that records it is the wrong order.
