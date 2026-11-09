## 1. Tests

- [x] 1.1 Web tests: a row created and edited through `/mcp` reads "via <label>" on the agent's entries only and says "created" once; a service account reads "nightly-sync edited via <label>"; a Version record reads "Changed by <person> via <label>". Red first
- [x] 1.2 Scenario "A change through an agent is marked" bound in `apps/web/test/scenarios/agent-access.test.tsx`, red first

## 2. Web

- [x] 2.1 `ActivityTimeline` and `ChangeRecord` show the "via <label>" chip; the agent's created entry folds into "created this"
- [x] 2.2 A Storybook story for a timeline entry with the agent mark, light and dark
