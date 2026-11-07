## 1. Tests first

- [x] 1.1 Unit tests for the fix-by time, the clock text and the warranty-soon rule
- [x] 1.2 Server tests: install, roles (staff can't change the register or a job), a report becomes a job with its place and fix-by time, a priority change moves it, assigning, Fixed needs a note
- [x] 1.3 Web component tests: the asset page and its report form, the label sheet for one place, the jobs board with assign and fix
- [x] 1.4 One browser journey: open an asset by its address, report a fault, see it on the board

## 2. Assets app

- [x] 2.1 App skeleton (`client-apps/jeyarama/equipment`), manifest with places, asset types, assets, jobs, three roles, permissions; built by `pnpm apps:prepare`
- [x] 2.2 Server rules for jobs: place and fix-by time, state on assignment, Fixed needs a note (any Assets person can be assigned; only technicians and managers can change a job)
- [x] 2.3 Pages: repair jobs board, assets list by place, asset page with report form and history, label sheet with QR codes
- [x] 2.4 Development sample data with Jeyarama's places, assets and jobs

## 3. Proof

- [x] 3.1 Try every checklist item in the browser against the running app, with screenshots
