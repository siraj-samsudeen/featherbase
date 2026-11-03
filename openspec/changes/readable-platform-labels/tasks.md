## 1. Acceptance examples first

- [x] 1.1 Implement executable steps for readable generated labels, authored-label preservation and default migration preservation; demonstrate red before source changes.
- [x] 1.2 Implement executable steps for Choice wording, original-value save/filter and verbatim fallback; demonstrate red before source changes.

## 2. Metadata and migration

- [x] 2.1 Carry optional authored choice labels through existing metadata paths; generate omitted labels with the shared helper.
- [x] 2.2 Migrate only enumerated old platform defaults and choice definitions; preserve custom labels, overrides and effective translations; verify rerun safety.

## 3. Displays and verification

- [x] 3.1 Use shared display lookup in generic forms, lists/cards, filters, peek, board/checklist and relevant public/report choices; keep wire values and indicator colors unchanged.
- [x] 3.2 Run HTTP, migration, component and acceptance checks; run strict OpenSpec validation and boot smoke checks.
- [x] 3.3 Inspect real desktop UI screenshots and choice interaction recording; independent verifier checks issue checklist at 1280px.
- [ ] 3.4 Prepare PR with verification and remaining owner gates; subscribe to CI/comments. Do not merge or manually deploy. Archive only after owner review of evidence.
