# Tasks

This change is the design umbrella for #449. It is docs only and stays open while the
build lands. Each build PR carries its own OpenSpec change, and verifies and archives
that change in the same PR. This umbrella is archived last, once every task below is
done.

## 1. Design (this change)

- [x] 1.1 Proposal, design and the `store-org-chart` spec, with synthetic data.
- [ ] 1.2 Fold in the business owner's answers (design "Open Questions" 1–4, and the
      "pending" notes in the spec).
- [ ] 1.3 Instance owner review of this change.

## 2. Preparation (client repository)

- [ ] 2.1 One-time preparation script: store HR files first, HR system for gaps, the
      existing workbook for its store, missing stays missing, conflicts and
      needs-matching listed per store.

## 3. Feather Dash tables and views (client app)

- [ ] 3.1 Layout tables: `store`, `store_floor`, `section`, `section_subcategory`,
      `display_location`, all marked `decides_scope` where they feed coverage.
- [ ] 3.2 `job_assignment`, with its shape, dating and one-store rules.
- [ ] 3.3 Alias tables (`section_alias`, `floor_alias`, `job_alias`) and the
      needs-matching view.
- [ ] 3.4 Coverage views and the scope provider inputs (B2 shape unchanged).
- [ ] 3.5 Org-chart conflict views, and the switch that enforces the one-owner rules
      per store.
- [ ] 3.6 Per-store "not live yet" flag, and the old-versus-new coverage comparison.

## 4. Platform features (this repository, each its own change)

- [ ] 4.1 #626 import remembers hand edits.
- [ ] 4.2 #627 maker-and-checker approval rules (reuses #622's mark).
- [ ] 4.3 #628 "What can this person see, and why" (extension point versioned under
      #617).
- [ ] 4.4 #629 glossary.
- [ ] 4.5 #462 scoped writers for `decides_scope` Tables (its own design).

## 5. Store org chart page (client app, with B6′ of #550)

- [ ] 5.1 Tree, coverage and conflict lists per store; numbered spec checklist and an
      independent verifier at 1280/375, light and dark.

## 6. Cut-over

- [ ] 6.1 First store live, after its lists are empty and its comparison is accepted.
- [ ] 6.2 Remaining stores, one at a time.
- [ ] 6.3 Retire the nine roster tables and `sales_target_assignment`; move the
      `store-org-chart` spec to the client's repository with the app.
