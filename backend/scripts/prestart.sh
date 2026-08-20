#! /usr/bin/env bash

set -e
set -x

# Let the DB start
python app/backend_pre_start.py

# Run migrations
alembic upgrade head

# Move chats out of tg_summaries and into their own aggregate.
#
# Runs here rather than by hand because a deploy is the only moment the schema
# and the data are guaranteed to be in step: `a9b0c1d2e3f4` creates the tables,
# and until this runs every existing chat is still a `tg_summaries` row that
# History will show as a summary with an empty body.
#
# It deletes rows, which is why it started life as an operator-run script. Three
# things make it safe to automate: it is idempotent (chat session ids are
# derived from the summary id, and an already-moved row is counted and skipped),
# it pages by keyset so a partial run resumes exactly where it stopped, and the
# migration's downgrade merges the transcripts back losslessly.
#
# After the first deploy it is a single query returning no rows — nothing is
# left that matches `_has_transcript()`.
#
# No `|| true`: `set -e` is deliberate here. A half-migrated database that boots
# anyway is worse than a deploy that stops and says why.
python scripts/backfill_chat_sessions.py

# Create initial data in DB
python app/initial_data.py
