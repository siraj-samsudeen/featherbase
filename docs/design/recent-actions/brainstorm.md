# Brainstorm — Recent Actions & Activity Recency

*Captured 2026-07-31, feather-brainstorm phase. This is a discussion log in
the owner's words plus horizon expansion — not a spec. The spec (feather-spec
form, in `docs/specs/`) comes after the owner picks a direction.*

## The owner's framing (verbatim intent)

> I want to create a way for the system to remember the recent actions I have
> done. I have seen myself accessing the same set of customers, doing the same
> set of filters, and then acting on a set of records all the time. We have to
> use search and multiple clicks through navigation links, which is all quite
> painful.
>
> What I am imagining is the command bar itself. When I press Control-K, it
> shows the recent activities I have taken — even the links that I have
> navigated to and the filters that I have done search on. Basically, it's
> like an audit trail.
>
> On the homepage, a Slack-style notification that can show it for me and for
> all users. Command-K, ideally under the search, shows me the recent things
> so that I can avoid searching again.
>
> If I do the same thing over and over many more times, there should be a way
> to look at that — recency and frequency are the two dimensions I am looking
> at. The whole idea is to make the system very, very friendly for people who
> are operating in it again and again.

Pain point: repeat operators re-do the same navigation + search + filter
sequence many times a day. The system should notice and shorten the loop.

Two dimensions named explicitly: **recency** and **frequency**. The
combination has a name in the industry — **frecency** (coined by Firefox for
its awesome bar ranking).

## What already exists in the codebase (leverage, don't rebuild)

| Piece | Where | Relevance |
|---|---|---|
| ⌘K shortcut + command bar | `apps/web/src/pages/AdminLayout.tsx` (UI-014/UI-015) | Today ⌘K only *focuses* the search input; dropdown shows Table matches, row hits from `/api/search`, and 3 hardcoded commands. The natural home for recents. |
| Filters in the URL | `ListView` + TanStack Router search params | A filtered list view **is already a replayable link**. "Remember my filters" = remember URLs. |
| `activity_log` / `access_log` | `apps/server/src/audit.ts` (PLAT-007) | Append-only audit tables, direct-insert (bypass saveDoc) by design. Today only login, print, export are recorded. Reads/navigations/searches are not. |
| `Version` table | written on every row save | Every **edit** is already recorded with who/when/what-changed. "Rows I recently acted on" is derivable with zero new capture. |
| `Comment` + `ActivityTimeline` | UI-019 | Per-row timeline pattern already established. |
| Home Pages | UI-027, `HomePageView` | Curated cards/shortcuts — the surface for a feed widget and for auto-suggested shortcuts. |
| Per-user list settings | UI-013 | Precedent for per-user persisted UI state (sort, hidden columns, filters). |
| Websockets | server `ws` | Live team feed is cheap once events exist. |

Key insight: **mutations are already fully captured** (Version, access_log,
activity_log). The only missing raw material is **read-side intent**: pages
visited, searches run, filters applied. That's the new capture this feature
introduces.

## The architectural fork: where do events live?

**A. Client-only (localStorage).** Router hook records visits/searches/filter
applications into a per-user localStorage ring buffer. Instant, private, zero
server load, zero schema. But: device-local, lost on cache clear, no team
feed, no cross-device, no analytics.

**B. Server-side event log.** A `user_event` table (a Table def like
everything else — invariant #1) receiving batched events. Cross-device, team
feed, frecency aggregates, real audit trail. Costs: write volume, a capture
endpoint, retention policy, privacy rules.

**C. Server-side capture via API middleware only.** Log `GET
/api/resource/:table` calls with their filters — no client changes at all.
Rejected as primary mechanism: TanStack Query prefetches/refetches pollute it
badly; it can't distinguish "user navigated here" from "cache revalidated".
Useful only as a supplement.

**D. Hybrid (recommended).** LocalStorage recents feed the ⌘K surface
optimistically (zero latency); the same events are batched to the server
(debounced `POST /api/events`, `navigator.sendBeacon` on unload) into
`user_event`, which powers the homepage feed, cross-device recents, and
frecency aggregates. Client cache is a warm mirror, server is truth.

## Event taxonomy (what counts as an action)

- `visit_row` — opened a form view (table, name, label at time of visit)
- `visit_list` — opened a list view (table, canonical filters+sort, URL)
- `visit_page` — report / dashboard / home page / builder
- `search` — awesomebar query submitted + which hit was chosen
- `filter_apply` — filters changed on a list (fold into `visit_list` with a
  debounce; a filter change *is* a new list state)
- Mutations — **not captured client-side**; derived from `Version` /
  `access_log` server-side where needed.

Each event: `user`, `kind`, `ref_table`, `ref_name`, `label`, `url`,
`occurred_at`. Retention: prune raw events after ~90 days; keep per-target
aggregates (`visit_count`, `last_visit_at`) forever.

## Ranking: frecency

Firefox-style bucketed frecency is simple and battle-tested: score each
(user, target) as `Σ over recent visits of bucket_weight(age)` with weights
like <4d→100, <14d→70, <31d→50, <90d→30, older→10, optionally weighted by
event kind (a row you *edited* outranks one you only viewed). Store the
aggregate per target; recompute lazily on write. Expose both orderings —
"Recent" (pure recency) and "Frequent" (frecency) — since the owner named
both dimensions.

## Surfaces (options, roughly in order of leverage)

1. **⌘K palette, empty state = recents.** Upgrade the focus-the-input bar to
   a true modal palette (Slack/Linear/Raycart pattern). Before you type:
   grouped sections — *Recent* (last N mixed items), *Frequent* (frecency
   top N), *Recent searches* (tap to re-run). Typing switches to today's
   search behavior, with results boosted by your frecency. Arrow keys +
   Enter, numbered quick-picks (⌘1…⌘9) optional.
2. **Homepage activity feed, Slack/GitHub style.** A feed widget with two
   tabs: *Mine* (everything I did, including views/searches) and *Team*
   (permission-gated; **mutations only** — broadcasting what colleagues
   merely *viewed* is surveillance, and no respected product does it).
   Live-updating via the existing websocket. Team tab derivable largely from
   `Version` + `activity_log` even before read-events exist.
3. **Sidebar "Recent" section** — Notion/Confluence/Salesforce pattern; the
   5–8 most recent rows/views always one click away, no keystroke needed.
   Cheap once the data exists.
4. **Per-table recents strip** — opening a Table's list shows "your recent in
   this table" (rows + filter sets) above the grid.
5. **Saved views as first-class metadata** — when the same filter set recurs
   (≥N times in M days), proactively offer "Save this view?" A `saved_view`
   Table (owner, table, filters, sort, name, shared-with-roles) makes the
   habit *explicit, nameable, and shareable* — Airtable/Notion's core trick.
   This is the highest-ceiling idea: it converts observed behavior into
   reusable artifacts.
6. **Auto-suggested Home Page shortcuts** — "You open Customer filtered to
   region=South daily; add it to your Home Page?"
7. **"Continue where you left off"** — on login, a one-line banner with your
   last 2–3 working contexts (Google Docs home / Netflix pattern).
8. **In-app back/forward jumplist** — long-press or dropdown on a history
   control listing this session's trail (browser/IntelliJ Ctrl+E pattern).
   Lowest priority; browsers half-do this already.

## Prior art scanned

Slack ⌘K (frecency-ranked switcher), Linear ⌘K (recents on empty state),
Notion ⌘P, Raycast/Spotlight, VS Code Ctrl+P (MRU order), Firefox awesomebar
(origin of frecency), Chrome omnibox, GitHub home feed, Salesforce "Recent
Items" + MRU lists, Gmail recent searches/chips, Airtable & Notion saved
views, Frappe's own awesomebar + sidebar Recently Viewed (`frappe.boot`
based, client-session only — we can do durably better).

## Privacy & permission stances (proposed)

- My own full trail (views, searches, filters): visible to me only.
- Team feed: mutations + logins only, gated by a role; no read events.
- `user_event` gets RLS: owner reads own rows; System Manager reads all.
- Events are append-only, direct-insert like `audit.ts` (a user must not be
  able to edit their own trail) — but **pruned** on schedule; it's a
  convenience trail with an audit flavor, not a compliance log.

## Scope boundary (this capability is NOT)

- Not a compliance-grade audit system (no tamper-proofing beyond append-only)
- Not analytics/BI over usage (could grow later from the same table)
- Not workflow automation ("do the action for me") — it shortens navigation,
  it doesn't act on records
- Not notification/inbox (assignment pings etc. are a separate concern)

## Recommended phasing

1. **P1 — ⌘K recents (client-side).** Capture visits/searches/filters in a
   router hook → localStorage; modal palette with Recent/Frequent empty
   state. No server change. Immediate daily-use payoff.
2. **P2 — `user_event` + batched `POST /api/events`.** Server truth,
   cross-device recents, "Mine" feed on the homepage; frecency aggregates
   server-side.
3. **P3 — Team feed** (mutations only, role-gated, websocket-live).
4. **P4 — Saved views + proactive suggestions** (save-this-filter prompt,
   Home Page shortcut suggestions).

Each phase ships alone and is useful alone.

## Open questions for the owner

1. Hybrid capture (D) with the P1→P4 phasing — agreed, or go server-first?
2. Team feed contents: mutations-only stance OK, or do you *want* read
   events visible to managers? (Recommend mutations-only.)
3. Is "saved views" (option 5) in this capability or its own follow-up
   capability? It's the biggest single idea here and may deserve its own
   spec.
4. Palette form: convert ⌘K to a true modal overlay (recommended), or keep
   the inline dropdown and just add recents under it?
5. Retention: 90-day raw events + permanent aggregates acceptable?
