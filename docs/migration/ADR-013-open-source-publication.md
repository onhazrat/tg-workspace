# ADR-013: Publishing the repository as open source

**Status:** Accepted (2026-09-04). Supersedes nothing; it is the first decision
about the repository as an artifact rather than about the software in it.

## Context

The repository has been private since the first commit on 2026-06-08: 379
commits on `main`, 176 pull requests, 138 of them squash-merged. It is being
made public.

The goal is narrow and worth stating, because everything below follows from it.
Publishing is for **credibility and as a reference for agent-assisted
development**. It is explicitly *not* to distribute software other people run.
Nobody casually deploys a stack that needs PostgreSQL, pgmq, a proxy pool and a
pinned single-replica sync tier, and promising otherwise converts a portfolio
piece into unpaid support.

Two things blocked publication, one of them serious.

A **live SOCKS5 proxy credential** sits in `docs/staging-ui-ux-audit.md`,
introduced by commit `036be65` and present in every commit since. The document
that contains it is an audit that flags it as a real staging credential and says
to rotate it. That did not happen for roughly a month. A scan of all 4,759 blobs
in history for API keys, bot tokens, private keys and connection strings found
this and nothing else; `.env` was never tracked.

There was also **no licence**, which makes a public repository readable and
legally unusable.

## Decision

**Licence is MIT.** The project descends from
[fastapi/full-stack-fastapi-template](https://github.com/fastapi/full-stack-fastapi-template),
which is MIT, so this satisfies the attribution already owed upstream. AGPL was
considered and rejected: it defends against commercial exploitation nobody
expects here, at the cost of making some legal teams flinch, and those legal
teams belong to the exact audience this is aimed at.

**The repository is renamed to `tg-workspace`.** The old name described a
migration that finished in July. `Workspace` is already a term in
[`CONTEXT.md`](../../CONTEXT.md), so the repository name, the README and the
glossary now agree on one word. Candidates naming a single output (`digest`,
`summarizer`) were rejected for undercounting: the glossary defines four
Artifact kinds and each of those names one of them.

**History is rewritten exactly once, before the visibility flip**, with
`git filter-repo --replace-text`, and it replaces two things: the proxy password,
and three channel handles from the live staging instance that appear incidentally
in investigation documents. Rotating the credential is required regardless and is
not a substitute for the rewrite, because a credential that merely *looks* live
still gets flagged by scanners.

**Commit timestamps are not rewritten.** All 589 commits carry a `+0330` offset.
Rewriting them was considered and rejected once the motive was examined: the
concern was how the repository presents to employers, and no recruiter reads
commit offsets. A profile location field does that job honestly in one edit,
where rewriting 589 timestamps is a fiction that buys nothing and is awkward if
noticed.

**Everything ships**, including `.scratch/`, `CLAUDE.md`, `docs/` and
`.cursor/plans/`. The ticket files, the guard table and the load investigations
are the part of this repository that is hard to find elsewhere. The feature code
is not.

**Issues are on, with no promise of support.** A closed issue tracker reads as
defensive and costs the occasional real bug report; one honest line in the README
does the same work.

**`TELEGRAM_WEB_DOMAIN` defaults to `t.me`.** It defaulted to the `telegram.me`
mirror, which is correct only where `t.me` is blocked and wrong everywhere else.

**Staging stays private.** Its address is not published. A separate public
instance follows later, with open registration and the existing quota ceilings
doing the containment.

## Consequences

- **The 138 squash-merge commits on `main` all change SHA.** The pull request
  pages and their diffs survive, but the merge commit each PR names is no longer
  reachable from any branch. Someone reading the PR history later will find this
  and have no way to derive why. That is the single strongest reason this ADR
  exists.
- **Publication is irreversible.** Deleting a public repository does not retract
  what was cloned, cached or indexed.
- **The rewrite strips every commit signature.** 99 of the last 100 commits on
  `main` are GitHub-verified today, because squash-merging makes GitHub author
  and sign the commit. Rewriting a commit changes the object it signs, so
  `filter-repo` drops the signature rather than producing an invalid one. The
  published repository therefore shows no verification badges at all unless the
  rewritten history is re-signed afterwards, which is a scripted amend across
  379 commits. This also means `main` temporarily stops satisfying the
  "every commit that lands on `main` must be signed" rule in `CLAUDE.md`.
- **The proxy credential must be rotated whatever else happens.** The rewrite
  removes it from what is published; it does not make an already-exposed secret
  safe.
- **Internal notes become public writing.** `CLAUDE.md`, the ticket files and the
  investigation documents were written for an audience of one and will now be
  read by strangers, including the parts recording things that went wrong.
- Anyone holding a clone from before the rewrite keeps the old history. Today
  that is only the author.

## What this does not decide

The **shape of the public demo instance**. The current lean is a read-only
`demo` account with self-service signup available for anyone wanting to explore
further, but "read-only" is presently a property of a View-as *session* rather
than of an Account, so a demo account is a new concept and not yet designed.

The **product name**. The repository is `tg-workspace` while the documentation
still says "TG Summarizer". They disagree on purpose for now, because renaming
the product touches `CONTEXT.md`, both compose files and 79 documents, and that
churn was not worth blocking publication on.

Whether **contributions** are accepted beyond issues. No `CONTRIBUTING.md` is
being written, and pull requests from strangers are unanticipated rather than
refused.
