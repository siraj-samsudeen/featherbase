# Tasks

## 1. Table details and grid controls

- [x] 1.1 Add a focused browser regression that creates at least two editable columns and locates the table details and each grid control by accessible role, purpose, and column number; verify the new assertions fail against the unnamed controls before implementation.
- [x] 1.2 Associate the existing table-detail labels and name every grid control without changing styling or behavior; verify the focused browser regression passes and distinguishes the two columns' repeated controls.

## 2. Card and row-naming controls

- [x] 2.1 Extend the browser regression to cover card-view controls and the row-naming method, prefix, and digit count by accessible role and name; verify the added assertions fail before implementation.
- [x] 2.2 Add stable label associations and column context in card view, and accessible names in the shared row-naming control; verify the focused browser regression passes in both views and the web typecheck succeeds.

## 3. Testing guidance and integration

- [x] 3.1 Document when E2E tests should prefer role-and-accessible-name locators and when structural test IDs remain appropriate; verify the examples agree with the focused regression.
- [x] 3.2 Run the complete web E2E suite and relevant web typecheck, and verify table creation, editing, validation, and imported naming behavior remain unchanged.
