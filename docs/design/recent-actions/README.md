# Recent Actions & Activity Recency

The system remembers what each operator has recently done — rows visited,
filters applied, searches run — and surfaces it so repeat work never requires
rebuilding the same navigation twice. Ranking uses the two dimensions the
owner named: **recency** and **frequency** (combined: *frecency*, Firefox's
coining).

This folder is the design reference for the capability, and its layout is the
template for future design work: a `docs/design/<topic>/` folder holding the
discussion log, an interactive exploration, and this index.

| Artifact | What it is |
|---|---|
| [design-exploration.html](design-exploration.html) | **Interactive exploration** — six clickable pattern demos (⌘K recents, activity feed, sidebar Recent, per-table strip, saved views + nudge, continue-where-you-left-off), prior art, capture-architecture comparison, frecency explainer, phased recommendation. Live rendered copy: [Claude artifact](https://claude.ai/code/artifact/46f01e47-fa05-413c-a12e-2dee5c16ae26). |
| [brainstorm.md](brainstorm.md) | Discussion log — the owner's framing in his own words, codebase leverage inventory, options considered, open questions. |
| [Issue #101](https://github.com/siraj-samsudeen/featherbase/issues/101) | Tracking issue — full requirements with hyperlinks and the phased implementation order. |

## The one-paragraph design

Capture is **hybrid**: a client-side router hook records visits, searches and
filter changes to localStorage (instant, private, powers ⌘K with zero server
work), and the same events batch to the server (`POST /api/events`, debounced,
beacon on unload) into a `user_event` table defined as Table metadata like
everything else. The server side unlocks cross-device recents, frecency
aggregates, and the homepage feed. Mutations need no new capture — the
`Version` table, `activity_log` and `access_log` already record them.
Privacy stance: an operator's full trail (including views and searches) is
visible to that operator alone; the team feed shows **changes only** —
creates, edits, submissions — never what a colleague merely viewed.
