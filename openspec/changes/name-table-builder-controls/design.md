# Design

## Context

See [proposal.md](proposal.md) for motivation. The table-building flow is split across the page, two presentations of the column editor, and a shared row-naming control. Visible labels are present in many places, but several are not programmatically associated with their controls. Grid headers do not label the inputs beneath them, and repeated actions use the same accessible name regardless of the column they affect.

The shared row-naming control also appears outside the table builder. Its names must therefore describe the naming choice itself rather than the surrounding page. Existing test IDs remain available, but accessibility coverage must query controls through their roles and names.

## Goals / Non-Goals

**Goals:**

- Expose meaningful names for every editable control in both table-builder column views.
- Give repeated controls enough column context to distinguish them.
- Name the shared row-naming method, prefix, and digit-count controls wherever the component is used.
- Preserve the current rendered appearance, state transitions, payloads, and validation behavior.

**Non-Goals:**

- Redesigning labels, column editors, or row-naming choices.
- Fixing other #294 areas such as filters, import-only controls, assignments, tags, account recovery, or unrelated icon buttons.
- Migrating unrelated browser-test actions to the E2E DSL.

## Decisions

### Associate visible labels before adding hidden names

The top-level table details and card controls will use stable control IDs with `htmlFor` on their existing visible labels. The row-naming component will expose concise names directly because its compact layout does not currently include separate visible labels.

This keeps the visible interface unchanged while making the existing words the source of truth where they already exist. Adding visually hidden duplicate labels everywhere was rejected because it adds markup and another copy of each name without improving the visible experience.

### Include column context at the repeated-control boundary

Each grid row and card will expose its numbered column context as a named group. Controls that remain ambiguous when considered independently, especially removal actions, will include the same column number in their own accessible name. User-entered labels will not be the sole identifier because they can be empty, duplicated, or edited while focus remains in the control.

Numbering was chosen over generated database names because it is always present and matches the visible “Column 1” context. Using only the current column label was rejected because blank new columns would still be indistinguishable.

### Verify the accessible interface through roles and names

Focused browser coverage will locate representative controls in grid view, card view, and the row-naming choices by accessible role and name. It will include at least two columns so a duplicate generic name cannot pass. Existing behavior assertions stay in place; this change adds accessibility assertions rather than rewriting the surrounding E2E suite.

The testing guide will state that role-and-name locators are preferred when the control has an accessible contract. Test IDs remain appropriate for structural containers and unsupported distinctions, so this is not a blanket locator migration.

## Risks / Trade-offs

- **[Risk] Names assembled from a group and a control may be verbose or vary between browsers.** → Assert the intended computed accessible names in Chromium and keep each component's naming relationship simple.
- **[Risk] Shared row-naming names improve pages outside this batch without covering all controls on those pages.** → Test the shared component contract, but do not claim those broader flows are fully accessible.
- **[Risk] Column numbering changes after removal.** → Derive context from the rendered order, matching the number already visible to the user.

## Migration Plan

No data or API migration is required. Deploy the markup and tests together. Reverting the UI commit restores the prior markup without affecting saved tables.
