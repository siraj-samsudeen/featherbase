## 1. Acceptance tests first

- [x] 1.1 Step definitions for the row-retirement scenarios (retire with a reason, the list leaves it out, show retired, reactivate), failing
- [x] 1.2 Failing server tests: retire and reactivate, reason required, permissions (delete for retire, write for reactivate), list/count/summary hide retired unless asked, related filters and comment visibility unaffected, history entry, import keeps retired and counts it, delete refusal offers retire

## 2. Server

- [x] 2.1 Standard columns `retired_at`, `retired_by`, `retired_reason` for stored Tables of kind table; reserved names; migration `0147_row_retirement.ts`
- [x] 2.2 `:retire` and `:reactivate` row actions with the delete/write checks, a lock and a history entry
- [x] 2.3 List reads hide retired rows unless a filter names `retired_at` or `with_retired` is passed; scope-provider lists include them
- [x] 2.4 Row capabilities report `retire` and `reactivate`; activity passes the retirement entry through
- [x] 2.5 Import dry run counts matched retired rows
- [x] 2.6 Delete refusals (history, links) offer Retire when the Table can retire

## 3. Web

- [x] 3.1 Record actions: Retire (with a reason dialog) and Reactivate; the retired badge and line on the form
- [x] 3.2 The list's "Show retired" toggle and the retired badge on a row
- [x] 3.3 The activity timeline shows retirements and reactivations
- [x] 3.4 The delete dialog offers Retire instead
- [x] 3.5 The import preview says how many matched rows are retired

## 4. Permanent delete (scope added 04-Nov-2026)

- [x] 4.1 Failing server tests: System Manager only, cascade preview, cascade and clear, blocked dependents, deletion records, import-run delete, rollback on a refused dependent, platform tables refused
- [x] 4.2 Migration `0148_deletion_record.sql`; `:purge_preview` and `:purge`; capability `purge`
- [x] 4.3 Delete-permanently dialog: from the form, the refused-delete dialog, the list's selection and an import run

## 5. Verify and close

- [x] 5.1 Server and web suites, typechecks and the acceptance scenarios pass
- [x] 5.2 Codex standard and adversarial reviews; blockers fixed, the rest filed
- [x] 5.3 Independent verifier against the issue's UI checklist, headless at 1280; every difference fixed
- [x] 5.4 `pnpm exec openspec validate retire-a-row --type change --strict`, sync the specs and archive the change
