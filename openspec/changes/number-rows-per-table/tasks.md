## 1. Acceptance examples first

- [ ] 1.1 Step definitions for the four scenarios (new table numbered 1, 2, 3; builder sample; a count per table; a number in use is skipped); demonstrate red before source changes.

## 2. Server

- [ ] 2.1 An `integer` naming rule; new tables of kind `table` default to it.
- [ ] 2.2 Series and integer counters keyed by Table; a Table rename carries its count.
- [ ] 2.3 Skip a number already used by a row of the Table.
- [ ] 2.4 Migration: each existing series Table takes over its prefix's counter.

## 3. Builder and import

- [ ] 3.1 The naming control offers plain numbers and previews 1, 2, 3; the builder and the import wizard default to it.

## 4. Verification

- [ ] 4.1 Server, shared and web suites; acceptance run; strict OpenSpec validation; HTTP repro; headless desktop check of the builder.
- [ ] 4.2 Sync and archive the change once verified.
