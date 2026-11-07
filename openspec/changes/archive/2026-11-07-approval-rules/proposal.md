# Approval rules: who may change which rows, and who approves

## Why

Some data is best changed close to the work, by the people who know it, but no single person should change it alone (#627, the store org chart #449). Today a Table either lets a role write or it doesn't. There is no way to say, as configuration, that a Helper's change to a Shelf waits for that site's lead, while the site lead's own change applies at once and is logged.

## What changes

- **Approval rules are data.** A System Manager adds rules for a Table: which columns and rows, who may make the change, and whether it applies at once and is logged, or waits for an approver. Approvers can be roles or people an app names for the row, such as "this site's lead", one or several, with all or any of them required.
- **A held change.** When a rule routes a change to an approver, the row stays as it was and the change waits as a Change Proposal (the platform Table #975 added), with the original and proposed values. Approvers are emailed through the same approval mail as workflows (#622).
- **Approve or reject.** An approver approves without needing edit permission on the row. Approving rechecks the rules and the values, then applies the change as the maker, and history names both. Rejecting records who and why. A value that changed meanwhile asks for a fresh review.
- **Safe by default.** A Table with no rules works as today. Once a Table has a rule, an edit no rule covers is refused, and System Managers are told about the gap.
- **Every route.** The form, inline and bulk edits, imports and the API all go through the same check, because they all save through one path.

Not here: delete (later, if something needs it), delegation (#462), and the org chart's switch-on (after #462). The row's pending-change strip and the decision screens come in the next slice of this change.

## Capabilities

### Modified

- `workflow-and-approvals`: approval rules decide whether a change applies, waits for an approver, or is refused.
