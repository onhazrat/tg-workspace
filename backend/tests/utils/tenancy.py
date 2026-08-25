"""A caller id for tests that read through the tenancy seam but are not about it.

Ticket 16 made `user_id` a required argument on `list_feed`, `lookup_posts`,
`count_posts_in_scope` and `compute_discover_candidates`. Tests covering
filters, caps, sort orders or report shapes still have to pass one, and while
`TENANCY_ENFORCED` is off it cannot affect their result — `scoped_select`
returns their statement untouched.

A fixed constant rather than a fresh `uuid4()` per call site, for two reasons:
a failure prints the same id every run, and a test that *does* come to depend
on the value has to reach for something other than the name `ANY_READER` to
get it.

Tests that assert on scoping build real Users and real Follows instead — see
`tests/services/test_post_tenancy_scoping.py`. Do not reach for this constant
there: it names no account, so a scoped read would find nothing for it and the
test would pass for the wrong reason.
"""

from __future__ import annotations

import uuid

#: Not a real account. Readable in a failure message as "ticket 16's any-user".
ANY_READER = uuid.UUID("00000000-0000-0000-0000-000000000016")
