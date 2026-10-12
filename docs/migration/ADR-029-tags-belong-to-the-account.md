# ADR-029: Tags belong to the Account, not the Follow

**Status:** Accepted (2026-10-12). Serves the Directory's follow-picks work
(`.scratch/directory-follow-picks/`); the prototype is the branch
`prototype/directory-follow-picks`, variant F.

## Context

A Tag is stored on the Follow today: it can sit only on a Channel the Account
follows, and unfollowing deletes it with everything else private about
watching that Channel. Tag runs apply AI-proposed Tags, and the Channel filter
tests them.

The Directory now needs a named group of Channels an Account builds to search
with: "Channels in this group", and "Shared parents / children of this group".
Most Channels worth grouping there are ones the Account does not follow yet,
so a Follow-scoped Tag cannot hold them.

## Decision

A Tag belongs to the Account and can sit on any Channel, followed or not. It
moves off the Follow into its own per-Account rows. Unfollowing keeps a
Channel's Tags; following it again brings them back. Everything Tags do today
(the Channels tab, Tag runs, the Channel filter) keeps working unchanged.

In the Directory a Tag is a Condition (`tag:"news"`, negatable) and a source
of Seeds for Shared parents / children and Cited by / Cites. The server
resolves the Tag in the query, so a request names the Tag rather than carrying
its Channels, a link stays short, and neither the number of Tags nor the
Channels per Tag needs a limit. A Condition naming a Tag the reader does not
have matches nothing; a link resolves against the reader's own Tags.

## Alternatives considered

- **A separate "List" concept** beside Tags, Account-wide over the Directory.
  It touched nothing that exists and would have shipped sooner, but it left
  two ways to label a Channel, and a Tag run's "news" could not be used as
  Seeds. Rejected: one concept, one word.
- **Tags on unfollowed Channels, still deleted on unfollow.** Rejected: a Tag
  describes the Channel as the Account sees it, not the act of watching it, so
  losing it on unfollow would discard work the Account did in the Directory.
- **The browser expands a Tag into handles** (as the prototype did). Rejected:
  every request would carry the Tag's Channels and need a size cap, and the
  links would grow with the Tag.

## Consequences

- The Follow no longer carries Tags, though it still carries everything
  private about watching a Channel. The Follow's sole writer stops writing
  Tags, and a new aggregate owns the Tag rows.
- A migration moves every Follow's Tags to the new rows, keeping their source
  (manual or AI) and when they were assigned.
- The tenancy seam classifies the new table as user-owned, the account export
  gains a Tags section (Tags on unfollowed Channels included), and View-as
  needs elevation to tag, like any other write.
- Tag runs still tag only followed Channels in their Scope; AI-tagging
  Directory entries would spend an Account's AI Key on Channels it does not
  follow, and is left to its own decision.
