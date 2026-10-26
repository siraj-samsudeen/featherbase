## ADDED Requirements

### Requirement: People who have left lose access

Once a day, Featherbase SHALL disable every person linked to a StyleHR employee record that shows they have left: an exit date that has passed, an inactive status, or not being on the latest payroll. A disabled person's sessions end at once. The check SHALL never re-enable anyone and SHALL never disable a System Manager; it reports them instead.

#### Scenario: A leaver is turned away

- **WHEN** the StyleHR record of a signed-in store employee shows an exit date that passed yesterday
- **THEN** after the next daily check their next request asks them to sign in, signing in is refused, and the activity log says they were disabled because their exit date had passed

#### Scenario: A System Manager is reported, not disabled

- **WHEN** a System Manager's StyleHR record shows they have left
- **THEN** they keep their access and the other System Managers are told by email to decide

### Requirement: A bad feed disables nobody

The daily check SHALL disable nobody when the StyleHR data it reads is more than a day old, or when it would disable more than one in twenty linked people at once. System Managers are told why.

#### Scenario: The warehouse stopped loading StyleHR

- **WHEN** the warehouse's latest StyleHR day is three days old
- **THEN** the check disables nobody and the System Managers get an email saying the feed is stale
