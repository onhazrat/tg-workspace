#!/usr/bin/env bash

set -e
set -x

# `scripts` is checked alongside `app` since ticket 22. It was not, and three
# maintenance scripts were found broken in one review: `backfill_user_id.py`
# listed five models whose `user_id` this ticket dropped and died on the first
# one, `cleanup_auto_follow_channels.py` treated the `(Channel, follow)` pairs
# `select_bulk_channels` now returns as bare Channels, and
# `backfill_post_media.py` had been reading `is_unavailable_on_web_view` off
# `Channel` — a `ChannelSettingGroup` column — since long before any of this.
# A script nothing type-checks breaks silently and is discovered by an operator
# running it, which is the worst moment to discover it.
mypy app scripts
ty check app
ruff check app scripts
ruff format app scripts --check
