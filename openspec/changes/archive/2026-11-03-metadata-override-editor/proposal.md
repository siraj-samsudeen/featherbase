## Why

Metadata Override requires a hand-typed ID and accepts column names and settings as free text. People should choose a valid target, set its value, and recognize the saved adjustment without naming a settings record themselves (#740).

## What Changes

- Use automatic IDs, plain labels, dependent column/setting pickers and typed boolean values in the existing generic form.
- Recognize an adjustment by its target and setting, and open the affected Table after saving.
- Preserve whole-Table adjustments, existing IDs, custom wording and the text value wire format.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `core-forms`: guided editing of metadata adjustments with identifiable saved targets.

## Impact

Metadata Override metadata migration, generic FormView extension, shared display-title function and public UI acceptance checks. This branch intentionally stacks on PR #774 at cbbfe03d5165103003ac417fdf63458e7d13fdd2 for its canonical property/value-kind map. It does not absorb #795 arrangement, #793 linked-row pickers, #792 title resolution, #769 recents synchronization or #826 generic label/Choice presentation.
