# Settings tab prototype (never merge)

Open `/workspace?tab=settings&variant=<key>` in a dev build. The pink pill at
the bottom, or the left and right arrow keys, cycles through the variants. Variant 0 is today's hub, untouched.

## The problem it answers

The old Settings tab and the `/settings` account page had four complaints.
Their looks were inconsistent. Settings for one account and settings for the
whole deployment were mixed together. Things were hard to find. Tools such as
diagnostics and SQL sat among settings although they are not settings.

Every variant uses one regrouping, by who a setting affects (`shared.tsx`):
this browser, your account, everyone on the deployment, or a tool. The
scope of each catalog id mirrors `backend/app/services/settings_registry.py`.
No backend change was needed. Writes are real, through the existing API.

## Variants and verdict

| Key | Idea | Verdict |
|-----|------|---------|
| A | Top tabs by audience, a group list per tab | Dropped. Folded into F, then the tabs removed too |
| B | One long page, a scroll-spy outline, tools in a side sheet | Dropped. F's one page comes from here |
| C | Search first: a big search box, "changed from default", browse list | Kept for comparison |
| D | Task cards ("Use my own AI key", "Get past Telegram blocking") | Kept for comparison |
| E | macOS System Settings: account card, coloured icon sidebar, inset cards | **Liked most.** Dropped once F replaced it |
| F | E's sidebar listing everything, over one scrolling page, with scroll-spy | Current favourite |

A, B and E are in the first commit on this branch (`git log` this folder).

The user's feedback on F's first draft was that A's segmented control was
unwanted, and the sidebar should list everything as E's does.

## Known gaps in F, best first

1. Every panel mounts at once on a page about 10,800px tall. Render sections
   only as they near the viewport.
2. A 256px sidebar does not fit a phone. Collapse it into a "Jump to" sheet.
3. Old panels bring their own titles ("Profile", then "User Information").
4. Account fills the top 2,000px. Start with your settings and put Delete
   account last.
5. Search filters only the sidebar. It should highlight rows on the page too.
6. Position is not in the URL. Wire `?section=` and `?setting=` deep links.
7. Deployment settings show to non-admins behind a banner. The frontend has
   no permission flag yet, so this may need a backend field.
8. Tools could open as their own workspace tabs instead of replacing the page.
9. The AI model field is plain text, unlike today's key-aware dropdown.
