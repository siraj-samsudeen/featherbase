
## 2026-08-11 — New Table page rebuilt: label-first grid + cards view + paste-a-list (#151)

Three UX prototypes ran as `?variant=` overlays on /admin/new-table (commits
`a058f67`..`126dec8`, since removed; the branch history is the primary
source). The owner's verdict: **A + C combined, B folded in** — and this
entry ships that as the real page.

- **The label leads.** The grid's first column is Field label; the Database
  name derives from it live (`slugify`) until the user edits the identifier
  directly, which claims it. Imported columns arrive claimed.
- **Two views, one state.** Grid (full engine type list, all dt-* spec
  contracts intact) and Cards (friendly type chips, per-type labelled
  detail controls, Reference target as a dropdown of real tables). Toggle
  persists in localStorage; grid is default.
- **Paste-a-list.** A collapsible box above the grid takes a spreadsheet
  header row (+ optional sample rows fed to the import's inferColumnType)
  and appends the columns.
- **Advisory inline validation.** `apps/web/src/lib/column-rules.ts`
  mirrors the server's snake_case/reserved/duplicate/target rules with
  one-click fixes (reserved names offer the table-prefixed convention,
  e.g. employee_name). Deliberately NON-blocking: Create always submits and
  the #128 server-error path stays the authority — both its specs pass
  unchanged. Reserved copy speaks Row ID vocabulary; see #132 (in flight)
  for the physical rename, after which `column-rules.ts` must swap
  'name'→'row_id' in RESERVED.

**Verified:** web typecheck clean; unit tests 54/54 (15 new for
column-rules); e2e doctype-builder + naming-series + import-file +
import-journey 8/8 against an isolated stack (featherbase_uxproto,
:8010/:5183); browser walkthrough of grid, cards, paste, reserved-name fix,
dark mode.

**Next:** verify the #132 agent's PR (name→row_id) when it lands, then
update RESERVED and the reserved-name message here in the same merge.
**Gotcha:** the cards view intentionally offers a friendly subset of types;
a column carrying any other type (Sub-table, layout breaks) renders as a raw
selected chip so switching views never loses state.
