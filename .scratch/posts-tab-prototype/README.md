# Posts tab improvements prototype

Throwaway. Variants on `/workspace?tab=posts&variant=`: `0` is main, `A` carries
the five changes (fill-the-row compact cards, the photo viewer paging the feed,
the window histogram, the Channel-posts-in-window bound, the reply Types).
Switch with the floating bar or Alt+Left/Right.

Run (placeholders, see docs/agents/prototyping-with-live-data.md):

1. Tunnel: `ssh -N -L 5433:<db-container-ip>:5432 <host>`
2. API: `cd backend && PROTO_API_BASE=<api-base> PROTO_PG_USER=<role> PROTO_PORT=8011 uv run python scripts/proto_posts_api.py`
3. Frontend: `PROTO_API_PORT=8011 PLAYWRIGHT_API_URL=<api-base> bun run --cwd frontend dev --port 5181`
4. `tailscale serve --bg --https=5181 http://127.0.0.1:5181`

`/api/v1/data/posts*` goes to the prototype API (this branch's real posts
router, read-only role); everything else to the deployment's API.
