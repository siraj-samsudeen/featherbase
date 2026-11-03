## 1. Acceptance examples first

- [ ] 1.1 Implement executable steps for readable generated labels, authored-label preservation and default migration preservation; demonstrate red before source changes.
- [ ] 1.2 Implement executable steps for Choice wording, original-value save/filter and verbatim fallback; demonstrate red before source changes.

## 2. Metadata and migration

- [ ] 2.1 Carry optional authored choice labels through existing metadata paths; generate omitted labels with the shared helper.
- [ ] 2.2 Migrate only enumerated old platform defaults and choice definitions; preserve custom labels, overrides and effective translations; verify rerun safety.

## 3. Displays and verification

- [ ] 3.1 Use shared display lookup in generic forms, lists/cards, filters, peek, board/checklist and relevant public/report choices; keep wire values and indicator colors unchanged.
- [ ] 3.2 Run HTTP, migration, component and acceptance checks; run strict OpenSpec validation and boot smoke checks.
- [ ] 3.3 Inspect real desktop UI screenshots and choice interaction recording; independent verifier checks issue checklist at 1280px.
- [ ] 3.4 Prepare PR with verification and remaining owner gates; subscribe to CI/comments. Do not merge or manually deploy. Archive only after owner review of evidence.
