## ADDED Requirements

### Requirement: The roster's status follows the HR record

When the roster names a left status, each roster run SHALL first set a current
row to left when its HR record has an exit date that has passed or is marked
inactive (the leaver check's rule), and a left row to current when its record
is active and on the payroll. Nothing else SHALL change a row's status, and
each change SHALL show in the row's Activity as the roster link's.

#### Scenario: An employee whose exit date has passed is marked as left

- **WHEN** the roster names a left status and a current row's HR record shows
  an exit date that has passed
- **THEN** the row's status becomes the left status, its Activity shows the
  roster link made the change, and the same run ends the person's sign-in link

#### Scenario: An owner-director off the payroll stays current

- **WHEN** a current row's HR record is off the payroll with no exit date and
  is not marked inactive
- **THEN** the row stays current

#### Scenario: A rejoiner is current again

- **WHEN** a left row's HR record is active and on the payroll again
- **THEN** the row becomes current and the same run links it

#### Scenario: A row the feed does not cover is left alone

- **WHEN** a row's record is not in the HR feed, or the row is in another
  status such as a test record
- **THEN** its status does not change

#### Scenario: A run that would change too many statuses

- **WHEN** the HR feed is stale or empty, or a run would change the status of
  more than one in twenty of the rows on the record and more than ten
- **THEN** it changes none and is reported as refused, and still links

#### Scenario: A roster that names no left status

- **WHEN** the roster names no left status
- **THEN** its status is only read, and the HR feed is not asked

## MODIFIED Requirements

### Requirement: People who have left lose access

Once a day, Featherbase SHALL disable every person linked to a StyleHR employee record that shows they have left: an exit date that has passed, or an inactive status. Being off the latest payroll alone SHALL never disable anyone. A disabled person's sessions end at once. The check SHALL never re-enable anyone and SHALL never disable a System Manager; it reports them instead.

#### Scenario: A leaver is turned away

- **WHEN** the StyleHR record of a signed-in store employee shows an exit date that passed yesterday
- **THEN** after the next daily check their next request asks them to sign in, signing in is refused, and the activity log says they were disabled because their exit date had passed

#### Scenario: A System Manager is reported, not disabled

- **WHEN** a System Manager's StyleHR record shows they have left
- **THEN** they keep their access and the other System Managers are told by email to decide
