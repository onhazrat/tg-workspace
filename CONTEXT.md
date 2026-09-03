# TG Summarizer

Self-hosted Telegram channel summarizer: it syncs posts from public `t.me`
channels into PostgreSQL, then runs AI operations over a chosen slice of them.
This file is the glossary. It holds no implementation detail — see `CLAUDE.md`
for architecture and `docs/migration/` for decisions.

## Language

### The corpus

**Channel**:
A public Telegram channel the operator follows. Identified by its handle.
_Avoid_: feed, source, subscription

**Post**:
One message scraped from a Channel.
_Avoid_: message, item, entry

**Scope**:
The slice of Posts an operation runs over: selected Channels × a date range ×
the active post filters. Every Artifact freezes a snapshot of the Scope it was
made from, so reopening one restores that selection rather than reinterpreting
it against today's.
_Avoid_: selection, range, filter set, context

### Scraping

**Lane**:
One proxy, with a limit on how many requests may pass through it at once. Every
request to Telegram leaves through a Lane, whatever kind of work made it.
_Avoid_: proxy pool, channel, connection

**Slot**:
One permit to scrape a Channel, pinned to a Lane for as long as it is held.
Holding a Slot is what makes a Channel's whole page walk leave from one proxy.
_Avoid_: worker, permit, gate

**Partition**:
Every Slot in one process, dealt across the Lanes. Its size comes from the
proxies, not from a number somebody chose.
_Avoid_: pool, gate, semaphore

**Sync worker**:
The process that runs the scheduler and drains the queue. It is never a Slot —
unqualified "worker" has meant both, and that ambiguity is why these four
entries exist.
_Avoid_: worker (on its own), consumer, background job

### Artifacts

**Artifact**:
A durable output a person deliberately asked for, carrying a frozen snapshot of
the Scope it was made from. There are exactly four kinds: Summary, Chat, Tag
run, Discovery report. The "deliberately asked for" clause is load-bearing — it
is what excludes Logs, Sync jobs and Embeddings, which are also durable rows
with timestamps but which nobody requested individually.
_Avoid_: record, output, item, entity

**Summary**:
An Artifact holding AI-generated prose about the Posts in its Scope.
_Avoid_: summary report, digest, report

**Chat**:
An Artifact holding a conversation about the Posts in its Scope. A Chat depends
on its Scope, never on a Summary — a conversation held while a Summary happened
to be open is still just a conversation about those Posts.
_Avoid_: chat session, conversation log, thread

**Tag run**:
An Artifact holding a set of AI-proposed Channel tags and whether they were
applied. Called a *run*, not a report, because it genuinely has execution state:
it can be pending, and it can fail.
_Avoid_: tag report, tagging, tag job

**Discovery report**:
An Artifact holding the candidate Channels found by scanning the Posts in its
Scope for outward references.
_Avoid_: discover report, discovery run, candidates list

**Pending**:
The state of an Artifact whose prompt was copied for an external AI but whose
response has not been pasted back. Applies to Summary and Tag run only.
_Avoid_: draft, incomplete, awaiting

### Chat modes

**Full scope**:
The Chat mode that sends every Post in the Scope to the model.
_Avoid_: summary mode, direct, standard

**Semantic**:
The Chat mode that sends only the Posts a vector search retrieved for the
question. It still has a Scope, which it optionally respects.
_Avoid_: history mode, RAG mode, retrieval

Note: `LLMLog.log_type` carries `chat_full_scope` and `chat_semantic` to match.
That field classifies *what kind of model call was made* (alongside `summary`
and `analysis`) — a different axis from the Chat's own mode, which is why they
are separate fields that happen to agree.

### Workspace

**Action**:
The workspace tab where every Artifact is created. The one entry point.
_Avoid_: create, new, studio, workbench

**History**:
The workspace tab listing every Artifact of every kind, newest first.
_Avoid_: archive, library, past runs

**Focus mode**:
The workspace with its chrome collapsed — no title block, no stats strip, no
width cap. Independent of native browser fullscreen, which is requested at the
same time but cannot be restored on reload.
_Avoid_: zen mode, fullscreen, distraction-free
