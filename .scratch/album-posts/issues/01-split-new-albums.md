# ALB-01: Each message of a new Album is its own Post

**What to build:** From the next sync on, an Album is stored as one Post per
Telegram message, as ADR-046 decides. Each Post records its Album by the first
message's id and carries its own thumbnail (and a video's duration) and the
Album's date. The caption, views, reactions, forward, reply and Links stay on
the first Post only. Every count includes every Post. Only the first Post is a
reply for the Post filter's Type, and a parent lookup or climb from a later
Album Post continues from its Album's first Post. Later Album Posts get no
prompt block and no embedding. A newest page ending in an Album records its
last id as walked. In the Posts feed each Post is its own card, marked
"Album · N of M". The spec is `.scratch/album-posts/spec.md`.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Syncing the saved Album fixtures (durov 373-381 with a video, durov
      510-511, TelegramTips 244-245) stores one Post per message, each with
      Album membership set to the first id, its own thumbnail, and a video's
      own duration.
- [ ] Caption text, views, reactions, forward, reply and Links are on the
      first Post only; later Album Posts have no text of their own and no
      views, and share the Album's date.
- [ ] A newest page whose newest widget is an Album records the Album's last
      id as the newest id walked.
- [ ] Shown and selected counts, the per-Channel cap, Channel posts in window,
      Summary Post counts, posting pace, the window check and the sync's
      per-Channel cap count every Post.
- [ ] Reach and estimated views are unchanged by later Album Posts.
- [ ] "Is a reply" matches only an answering Album's first Post; "Has a reply"
      marks the photo that was answered.
- [ ] A parent lookup and a climb from a later Album Post continue from its
      Album's first Post.
- [ ] Prompt assembly gives a later Album Post no block (the first Post keeps
      its "Album: N items" line), and later Album Posts are not embedding
      candidates.
- [ ] Retention removes an Album's Posts together.
- [ ] The API exposes Album membership and the Album's size; the post card
      shows "Album · 1 of 4" on the first Post and "Album · 2 of 4" on the
      second, replacing the " (n)" count.
- [ ] An Alembic migration adds the Album column; tests run at the sync seam
      with fixture pages, the Posts reads seam, and the card render, each
      mutation-checked.
