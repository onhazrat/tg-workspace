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

**The project is published as `tg-workspace`, in a new repository.** The old name described a
migration that finished in July. `Workspace` is already a term in
[`CONTEXT.md`](../../CONTEXT.md), so the repository name, the README and the
glossary now agree on one word. Candidates naming a single output (`digest`,
`summarizer`) were rejected for undercounting: the glossary defines four
Artifact kinds and each of those names one of them.

**History is rewritten, and the old repository is abandoned rather than
force-pushed.** `git filter-repo --replace-text` removed the proxy password and
three staging channel handles across all 381 commits, and every commit was then
re-signed with the author's own SSH key so nothing lost the verification a
squash merge used to supply.

That alone was not enough, which is the reason this ADR exists in the shape it
does. GitHub creates a permanent `refs/pull/<N>/head` for every pull request and
gives the repository owner no way to delete one. A force-push writes only
`refs/heads/main`, so all 176 of those refs would have kept pointing at the
original commits: four blobs holding the unredacted audit document, fetchable by
anyone with `git fetch origin 'refs/pull/*/head'` the moment the repository went
public. Asking GitHub Support to purge them was the alternative, and it trades a
support ticket and an unknown wait for keeping the pull request pages. Starting
a new repository was chosen instead because it is certain and immediate, and
because the writing those pages held could be preserved another way.

Two smaller traps were found on the way and are recorded because they are easy
to repeat. `filter-repo` silently skips refs that point at a tree rather than a
commit, and eight `refs/codex/turn-diffs/*` refs left by editor tooling did
exactly that, so the credential survived the first pass while every commit-borne
copy was gone. And `main` carries 24 merge commits from the era before the
squash-only convention, so re-signing used a `commit-tree` walk in topological
order; `rebase --root --exec` would have flattened them.

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

- **176 pull request pages are left behind with the old repository.** They held
  about 566,000 characters of written rationale, roughly one essay per change,
  which is a large part of what makes this repository worth reading. They are
  exported to [`docs/pr-archive/`](../pr-archive/) rather than lost: verbatim
  text under the same redactions, greppable, and carried by every clone. What
  does not survive is the timeline itself. Recreating the pull requests in the
  new repository was considered and refused, because GitHub cannot backdate one
  and 176 PRs stamped with a single day would be a fabricated history.
- **The staging deployment has to be rewired.** Nine secrets in the `staging`
  environment, the environment itself, and the self-hosted runner registration on
  the Hetzner box all belong to the old repository and do not travel. Staging
  cannot deploy until they are recreated.

- **The old repository is kept, private, rather than deleted (2026-09-05).**
  `onhazrat/tg_summarizer_migrate_to_fastapi` still holds the proxy credential
  in four blobs across its 176 `refs/pull/*/head` refs, and nothing the owner
  can do removes them. Keeping it is acceptable only because the credential was
  rotated: what those refs hold is dead. The standing risk is a visibility flip.
  That repository must never be made public, and if it ever should be deleted
  instead, note that everything worth keeping from it already lives in
  [`docs/pr-archive/`](../pr-archive/).

- **Publication is irreversible.** Deleting a public repository does not retract
  what was cloned, cached or indexed.
- **Every signature on `main` is now the author's, not GitHub's.** 99 of the last
  100 commits were GitHub-verified because squash-merging makes GitHub author and
  sign the commit, and rewriting a commit invalidates the signature over it. All
  381 commits were re-signed rather than published bare, which took 49 seconds
  and preserves author dates, committer dates, parents and messages. The
  `CLAUDE.md` signing rule is satisfied by a different party than before.
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
