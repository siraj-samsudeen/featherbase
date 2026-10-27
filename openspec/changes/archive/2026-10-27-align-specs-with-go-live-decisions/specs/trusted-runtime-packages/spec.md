## REMOVED Requirements

### Requirement: App data is reachable only through the app

**Reason**: While an app is on, dashboard counts and charts already reach its data within the person's own permissions, and the owner decided on 27-Oct-2026 that this is right (#521).
**Migration**: None; the replacement requirement below describes what the product does.

## ADDED Requirements

### Requirement: Dashboards reach an app's data only while it is on

While an installed app is on, a dashboard number card or chart SHALL be able to count its data, showing only what the person's own permissions let them read. While the app is off or unavailable, its data SHALL NOT be counted or charted at all, and it stays stored for when the app is turned back on.

#### Scenario: Count an app's data on a dashboard

- **WHEN** a member who can read an app's tasks adds a card counting them while the app is on
- **THEN** the card shows how many tasks there are, and a member who can't read those tasks is refused

#### Scenario: A turned-off app's data is kept out of dashboards

- **WHEN** an administrator turns the app off and someone opens that card or a chart of the same tasks
- **THEN** it's refused, and the tasks themselves are kept
