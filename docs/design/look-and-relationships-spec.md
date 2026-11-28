# Featherbase Look And Relationships — spec checklist v3 (Siraj agreed, 19-Nov-2026)

Boards: docs/design/mockups/look-and-relationships.html (every canvas board, live, on made-up test data). Build each issue pixel-perfect to the boards it names.
v3 replaces v2's Part 2 with what Siraj decided in the walkthrough. Part 1 is unchanged except item 17 (one grey block per pane).
The UI owner agreed to v2; v3 routed 19-Nov-2026 (siraj-samsudeen/featherbase):
- #1348 calmer look (items 1–17 + dark mode) → frame builder, after #1328
- #1289 option C Click To Narrow + Connections + ▾ + previews + Linked count (items 19–29) → frame builder, after #1348
- #1349 count row, zero tables folded, ↑/↓ in peek (16–18) → relnav
- #1350 five views, order N5, N1, N3, N2, N4 (30–34) → relnav, after its queue
Changes from Siraj go through the UI owner, who updates the issues.
Business rules for #1350 (Siraj, 19-Nov-2026):
- Rule 1 · Which plant: a sentence lists ALL the site's plants ("Bayside (plants 9101 Fashion Store, 9102 Supermarket, 9103 E-commerce)") until a section is linked to its plant; then it names that one. Never guess a plant.
- Rule 2 · Missing team leader: a section with no team leader recorded is a red "Things To Check" gap on the section, subcategory and store pages; a section can be marked "No team leader needed", which turns it off for that section only.
Issues in the public featherbase repo use made-up examples only (Bayside, Northgate, Kumar Test-Staff…).

## Part 1 · Visual system (shared tokens on shared components) → frame builder
1. Canvas #F4F5F7 behind the sidebar and panel; one white panel per page, radius 14; content fills the space after the sidebar.
2. No row rules, no column rules, no boxes round inputs or filters; separate with space and quiet fills.
3. Table header is a quiet-fill band (36 px); row hover and selected row #F1F5FF.
4. Buttons are fills (grey #F1F2F4; one blue primary per page); inputs grey-filled; focus is the only outline.
5. Raised surfaces (menus, peek, hover cards) use shadow, no border.
6. Page title 20/600 through the shared PageHeader on every page; group heading 15/600; body 14; meta 13 grey. Title Case.
7. Spacing 4/8/12/16/24/32.
8. Comfortable rows (44 px) by default; Compact Rows (32 px, faint zebra) is the toggle.
9. Status chips: green live, amber not yet, grey finished.
10. Category chips: 8 tints, one stable tint per value; levels (Own/Team/Area) stay neutral.
11. Lookup chips that are records are RecordLinks: a plain click opens the record.
12. Source/reach/level use the shared `tag` chip only.
13. Red tint only for data problems and gaps.
14. Blue = opens something; codes, dates, plain numbers and choice values are not blue.
15. Empty fields stay blank; the Grid keeps "—" for "not given".
16. Record header: muted table kicker, name as title, no code; then a row of blue count chips for every non-empty link (two-step ones say "through X"), hover shows the shared peek card.
17. Links tab and panes: ONE quiet-fill block per pane (the fields); every other group is a heading plus rows on white; never a fill per group, never cards inside a fill. Zero-count "Pointed At By" chips fold behind "+ N tables with none"; worked-out sections keep their muted empty line.
18. Record pane = the built peek stack, restyled; new: ↑/↓ moves through the list (→ relnav).

## Part 2 · Click To Narrow (the QlikView model) → the #1289 option C item
19. A "Click To Narrow" panel on every list, left of the table, one quiet fill; one list per table field and per linked table (incl. two-step paths), each named by its table only — no group headings.
20. Every click updates every list and every count at once. Picked = green; still possible = white; ruled out = grey with 0 (kept visible, sorted below).
21. Each list shows its top 6 by count, picked values pinned on top; lists over 12 values get "Find in <Table>"; "Show all N" opens a fixed-height scroll box (~8 rows), never grows the page.
22. Each list's heading shows "<possible> of <total>".
23. Picked values appear above the table as removable green chips, with Clear all and Save as view; they read through the shared Sentence component.
24. Clicking a result row opens a drill panel on the same page: the row's main records (e.g. section with staff counts by job and what else it sells; subcategory with its hierarchy and where it is sold), "Narrow to this …" buttons, and Open buttons. Esc closes.
25. Ticks compile to the #1276 Linked to / Not linked to filters, so URLs and saved views keep working.
26. Connections (C): a button at the top of the panel showing count tiles for what the current filtered set links to; clicking a tile switches to those linked rows (the set, not one record), with a trail back.

## Part 3 · Values you can act on (board B) → #1289 option C item
27. Hover any chip or link in a cell → a small ▾ (also right-click): Only <value> (count), Leave out <value> (count), Open <value>. A plain click on a record still opens it; choice values may open the menu on click.
28. Hovering a count shows a peek card with the first rows and "Open all N as a list".
29. "+ Linked count" in the table header adds a count column for any linked table (incl. "via" paths); each count opens the rows, already filtered.

## Part 4 · Ways to walk relationships (new items)
30. Sentences (N1): record pages for chosen tables open with short sentences grouped under 5W+H labels in one order everywhere — Who, What, Where, When, How Much, How Many. Every noun is a link. Sentences come from templates written once per table in its settings, filled from links; a blank link becomes a red "Things To Check" line. No AI.
31. The Spine (N2): a horizontal chain from the record up to the top of its hierarchy; each step is a link with its table as a grey kicker and a ▾ listing siblings with counts; side branches (e.g. Reports To, temporary posting, Sold In, Bought By, responsible heads with "vacant" in red).
32. Columns (N3): a browse view where each column is a table and picking a row fills the next; counts on every row; the walk path can be switched (e.g. Site → Floor → Section → People, or Site → Plant → Business Unit); columns never fold; the last column previews the picked row, or "<record> At <store>" when picked from Sold In.
33. Matrix (N4): for link tables (e.g. Section Subcategory), a plain cross-table: rows × columns, the linked record name in each cell, red "Not placed" / grey "Not sold", no colours or summaries; hovering a cell tints its row and column and shows a card.
34. Map (N5): today's Map (left = points to, right = pointed at by, one step) stays the default. A "Neighbourhood" mode on the same components adds, per table configuration (later per app): layout by meaning (up / down / sides), labelled lines, an optional second ring for chosen two-step paths, red gap notes. In both, clicking a group shows its rows at the bottom of the same page; Focus re-centres, a plain click opens.

## Part 5 · Additions from the rebuild's screens (proposed 19-Nov-2026, not yet agreed item by item)
Boards: docs/design/mockups/pages/screens.html and report.html, styled by pages.css in the same folder. Plain HTML, no build step; open screens.html from disk. They are the rebuild's generic screens (branch featherbase-redesign, features/foundations/pages, PR #1332) restyled to Part 1, on the made-up employee sample. This folder is a copy as of commit 615626b; the rebuild's folder is the source.
Siraj's aim: the React screens here and the HTML screens of the rebuild look the same. These items are what that needs beyond Parts 1–4.
35. One file of named values: the block at the top of pages.css holds every colour, size, gap and radius of Part 1 under a name (--canvas, --panel, --quiet, --fill, --hover, --accent, --row …). The shared components point their theme at the same names, so a value is changed once and shows in both.
36. Dark values: Part 1's boards are light only. pages.css proposes a dark value beside each light one (light-dark()). To agree, then use in #1348's dark mode.
37. Which tint a value gets: board 1 says "taken from its name"; the rebuild gives tints out in the order of the list of values. Pick one rule for both.
38. Chart colours: a Choice value's bar wears its chip's colour at full strength (--c1 … --c8); the bar is always named as well, never colour alone; a total is neutral grey. The first five are checked for colour-blind separation in light and dark; the pink was moved toward magenta to clear orange.
39. Home (screens.html#fresh, #home): actions are quiet-fill blocks; Tables, reports and uploads are rows on white with a blue count chip; nothing greyed out as coming later.
40. Entry to importing (#import): one quiet-fill drop block with the primary button, then three numbered steps as plain text.
41. Proposal (#proposal): a Columns table (type select, what was seen, key radio) and a preview of the first rows, both with the quiet header band; Create is the one blue button.
42. Form (#record, #new, #refused): inputs are grey-filled with no box; a refusal sits under its field in red with a red inner outline on the input; Delete asks in a raised pop-up; the record pane is raised with a muted table kicker and the name as title.
43. Row height and record opening (#employees): Comfortable / Compact Rows is the segmented control beside the list, as on board 2; "A record opens as" (side panel or full page) is in the View menu.
44. Report (report.html): one row of filters, headline numbers in quiet-fill blocks, charts on the white panel with a title and one sentence each, "Show as a table" under every chart, then the rows behind a number as an ordinary table. No chart library, no script.
Each screen and state has its own address, so a verifier can open and screenshot it directly.

## Verifier (per build)
A separate verifier subagent runs the real UI against the items in its issue and returns a "spec vs built" table with screenshots before Siraj sees anything.

## Still to draw before those issues are built (optional, quick)
- Item 26: the Connections button and tiles on top of the Click To Narrow panel.
- Item 30: the table settings screen where an admin writes the 5W sentence templates.
- Item 34: today's Map with the Neighbourhood mode switched on, side by side.
