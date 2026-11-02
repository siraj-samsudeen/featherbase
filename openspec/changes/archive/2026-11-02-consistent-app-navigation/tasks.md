## 1. Acceptance first

- [x] 1.1 Add failing acceptance steps for changing apps through the shared name and filtering destinations by access; reuse existing real-server fixtures.
- [x] 1.2 Add failing acceptance steps for Tasker project selection and Feather Dash store preservation through shared navigation.

## 2. Shared navigation

- [x] 2.1 Extract and reuse the existing native application selector in AdminLayout and app TopBar, preserving the server handoff when opening Featherbase and removing the separate administration control on app pages.
- [x] 2.2 Add the shared sidebar element to the app-page bundle with neutral selected/focus states and the bar's theme, keeping app document styles isolated.
- [x] 2.3 Adapt Tasker's navigation without changing its callbacks, counts, projects, task inspectors or saved views; remove retired navy sidebar styling.
- [x] 2.4 Give Feather Dash the shared report sidebar while preserving the selected store; bump both app versions with the existing no-op upgrade convention.

## 3. Verification and handoff

- [x] 3.1 Run relevant component/app tests, type checks, platform-import and version checks, plus the running stack smoke check.
- [x] 3.2 Run the change's acceptance scenarios with zero pending or undefined steps and an HTML report.
- [x] 3.3 Inspect real desktop light/dark states, dropdown choices, Tasker project/task interactions and Feather Dash store retention; record the interaction and have an independent UI verifier check the issue checklist at 1280px.
- [x] 3.4 Reconcile the overlapping no-switcher rule in the active Feather Dash change, validate this change strictly, and leave archive for the owner's review of the UI evidence.
