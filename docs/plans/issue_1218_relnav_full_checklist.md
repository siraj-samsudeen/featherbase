# #1218 Relational navigation, built to the design in full: the checklist

The owner asked on 18-Nov-2026 for **exactly 100%** of what the design promised, all slices, plus the switch-over of Dash access to business roles. The design is `docs/plans/issue_1218_relational_navigation.html` (branch `issue-1218-jobs-and-roles`). The screenshots of every state of it, used by the verifier as the target, are in the session notes folder `relnav-slice1-compare/design-*.png`.

Every line below is a promise of the design. The verifier checks each one in the real app and returns a "spec vs built" table with screenshots. ✅ = already on main (slice 1, #1272).

Issues: slice 2 #1273, slice 3 #1274, slice 4 #1275, slice 5 #1276, switch-over #1277.

## A. Rules that hold everywhere ("simple like Tableau")

- A1. One obvious default in each place: the record panel shows Links, the record page opens on Form, the Map opens on Neighbours.
- A2. An option appears only where it applies: Grid only for small pairs (both sides about 40 or fewer), Why only where a chain is declared, ticking only where the viewer may change that link.
- A3. Controls sit beside what they change: Open as grid on its group, Focus on its box. One **View ▾** menu holds the rest. No settings dialogs with tabs.
- A4. Every view choice is remembered: in the saved view when one is open, otherwise per person per Table. The app admin sets each Table's starting default.
- A5. The same pieces everywhere: one linked-rows group, one tick list, one grid, one map, one area picker. They work the same in Featherbase, Dash and Tasker.

## B. List page: find rows

- B1. "Add filter" gains **Linked to…** and **Not linked to…**, so a chain like Explore's is built from the list. Each step of the chain shows its count.
- B2. Every link cell in a table offers two hover actions: **Go there** and **Filter** (today they exist only in the panel's chips).
- B3. Explore is retired. Its menu entry goes, and old Explore addresses open the matching filtered list.

## C. Record panel (the Lens): a quick look

- C1. Order: path bar, header ("Priya S." with "Person · Employee · Floor Manager"), link chips, then fields beside the relationship sections (two columns when wide, one when narrow).
- C2. ✅ A "Pointed At By" group lists one line per row, by the far side's name, with up to two facts.
- C3. ✅ First 10 rows, then "Show all N"; "Open as list" on every group.
- C4. An empty group is greyed, never hidden, and offers **+ New**, which opens a new row already linked to this record.
- C5. **A relationship you may change is a tick list**: its header reads "Business Roles 2 of 7" and it lists every choice, ticked ones first with their area and end date, unticked ones greyed.
- C6. Every ticked link carries a **source chip**: "from HR" (from a feed) or "given by hand".
- C7. A link from a feed is **locked** (a tinted tick that cannot be unticked) and offers **Correct** beside it.
- C8. Ticking an unticked choice opens an **inline form** under it: "Also give **Team Leader** · Area [Pick on the trees ▸] · Ends [optional] · Reason [...] · Add · Cancel". Nothing is saved until Add.
- C9. Unticking a hand-given link removes it (with the save state "✓ Saved").
- C10. **Worked-out sections** ("Apps She Can Open 3 · worked out from her roles", "Reports She Sees 3 · given to her roles") show a locked tick, the name as a link, a detail line ("at level Reader", or the area), a "via Floor Manager" chip, and **Why?**.
- C11. **Why?** opens a one-line chain under the row, for example "Priya S. → Floor Manager (Store C · First floor) → Vendor Sales", and changes to **Hide why**.
- C12. **Open as grid** sits on the header of any group whose two sides are small (A2).
- C13. A long section folds after ten.
- C14. **Peek stack**: clicking a linked name stacks a panel over the page. The panel shows "← · Level N of N · Open Full Page · ✕". ← goes back one, ✕ and Esc close them all. Each peeked panel shows its groups with the first 4 rows and "Open as list".

## D. Record page: work on one record

- D1. Tabs: **Form · Links · Map · Activity**. The page opens on Form. (Today's Tree becomes Links. Today's Collaboration tab folds into Activity.)
- D2. Links is the Tree's unfolding plus everything in C5–C13: ticking, source chips, Why? and Open as grid. Each group is capped at 10, then Show all.
- D3. The chips under the title jump to their section on the Links tab.

## E. Map: see and explain

- E1. The **Neighbours | Why** toggle sits above the map. Neighbours is the default. Why appears only where a chain is declared (A2).
- E2. Neighbours mode: the record's own links on the left, each box showing the link's name small and the target's name, in blue when it can be focused.
- E3. Groups on the right show their name, their count, and **their real rows inside the box**: the first 4, then "+ N more in the panel". An empty group stays, greyed.
- E4. ✅ A link table collapses to its far side ("Employee 7 · through Job Assignment").
- E5. Every row that can be opened reads in blue and has **Focus** at its right. Clicking re-centres the map on that record, and **the path bar gains a step**. Clicking an earlier step walks back.
- E6. Why mode draws the declared chain in columns: **Person → Business role · area → App · level → What she can do**. Each role box says "· HR" or "· by hand", and each permission shows its reach.
- E7. In Why mode, clicking a box lights up every chain that leads to it, back to the person. Clicking again clears it.
- E8. Boxes are keyboard-reachable; Enter or Space acts as a click.
- E9. ✅ The "Open in Explore" button is gone.
- E10. The map shows one record at a time, never a whole table.

## F. Grid: compare or tick many at once

- F1. Offered only where both sides are small (A2): roles × permissions, reports × roles, departments × sections.
- F2. **Permissions × Roles**: one row per permission, grouped under an app heading row, one column per role. Clicking a cell steps through **— · Own · Team · Area · All**, coloured by reach. The first column stays put while scrolling.
- F3. **Reports × Roles**: one row per report (the name is a link), one column per role, cells tick ✓ or untick —. One grant per report covers every ticked role.
- F4. A toggle at the top swaps between the two ("Permissions × Roles | Reports × Roles"), with a one-line hint of what a click does.
- F5. **Changes wait**: each changed cell is outlined, and a dark bar shows "N changes waiting · affects about X people · Discard · Review and save". Nothing is saved before Review and save.
- F6. The grid replaces the separate permission matrix.

## G. Area picker (Columns): only for picking an area

- G1. It opens from "Pick on the trees ▸" in the Also give form (C8) and from Correct. It is never a general view.
- G2. Axis toggle: **Location | Merchandise**.
- G3. Location columns: **Region › Cluster › Store › Floor**, with counts ("3 stores"). Merchandise columns: **Division › Subdivision › Category › Subcategories**.
- G4. Picking in a column clears the columns to its right. The bar below reads "Area: Tamil Nadu › Chennai South › Store E", with **Stop here** and **Use this area**. With nothing picked, it reads "Whole company" or "All merchandise".
- G5. On a phone it becomes one column with a back arrow.
- G6. Admin screens say Site; staff screens say Store; Plant is never shown (D7 of #1218).

## H. Sentences: a label everywhere

- H1. Every permission reads as one line, for example "[Store Managers] can [Edit] [Sections] `Area` in their store", with the reach chip coloured as in F2.
- H2. Every report grant reads as one line, for example "[Vendor Sales] is given to [Store, Floor, Department and Cluster Managers], each sees their own area".
- H3. The same line is used on the business role page, as the Grid cell's tooltip, in the Lens's Why?, and in the change log.
- H4. A business role page's header reads "Business role · 25 people · from HR title and by hand".

## I. Path bar: where I came from

- I1. A **sideways ▾** sits beside the current step. It lists the other rows of the list you came from (another floor manager at the same store) and jumps to one without going back up.
- I2. Back · Forward · steps · Recent paths · Copy link, as today.

## J. Switch-over: Dash access comes from business roles

- J1. The starting roles are added in production (the one-time "Add The Starting Roles").
- J2. Who opens Dash, and which stores and merchandise each person reaches, are decided by business roles and their grants. Today's rules stop deciding.
- J3. Report grants to roles replace the old grants. Grants to Dash Reader become grants to the matching business roles.
- J4. The change is tried on staging (a copy of production) first. The before and after "who opens Dash, who reaches what" are compared there, and the differences are listed for the owner. The owner said access differences are handled afterwards.
- J5. One switch can put the old rules back if production goes wrong.
