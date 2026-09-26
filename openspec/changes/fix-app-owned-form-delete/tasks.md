# Tasks

## 1. Generic form deletion

- [ ] 1.1 Add PostgreSQL-backed component regressions using a package discovered and installed through the real app lifecycle: prove the current generic form fails to delete a fresh app-owned row and refuses a stale loaded revision while preserving the newer row; run the focused test first and record the expected failure.
- [ ] 1.2 Change the generic form delete request to include the loaded row revision whenever one exists, without changing the server contract or source-bound conditions; verify the fresh and stale app-owned regressions pass.
- [ ] 1.3 Run the existing source-bound deletion component test with the new app-owned regressions to verify bound-table revision forwarding and successful deletion remain unchanged.

## 2. Integration and review

- [ ] 2.1 Run the web typecheck and strict OpenSpec checks, then inspect the rendered component's success navigation and stale-conflict dialog state through DOM assertions; record exact commands and results.
- [ ] 2.2 Run Feather Code Review over the scoped diff, resolve all in-scope findings, rerun affected checks, and commit the verified change for independent parent review.
