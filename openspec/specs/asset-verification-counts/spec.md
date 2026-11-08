# Asset verification counts

## Purpose
Blind counts of a site's assets against a fixed expected list, recorded by counters and
decided line by line by a reviewer before the count closes.

## Requirements

### Requirement: Plan a count

An Assets Manager SHALL be able to plan a count of a site or of a place inside it, as a full,
sample, targeted or custodian self-check count, with its dates, its counters and one reviewer. The
reviewer SHALL NOT also be a counter.

#### Scenario: A full count of ATK

```gherkin
Given ATK 1501 is a site
When a manager plans a full count of ATK 1501 with Suresh counting and Meena reviewing
Then the count is Planned, waiting to start
```

#### Scenario: The reviewer cannot count

```gherkin
Given Meena reviews the ATK count
When a manager adds Meena as a counter
Then the change is refused, saying the reviewer can’t also be a counter
```

### Requirement: Starting fixes what is expected

Starting a count SHALL fix the list of assets expected in its place at that moment, and record when
and how many. A sample count SHALL expect only the chosen number of assets, picked at random. Later
changes to the register SHALL NOT change a started count's expected list.

#### Scenario: Start the ATK count

```gherkin
Given ATK 1501 has 12 assets in the register
When a manager starts the full count of ATK 1501
Then the count is Counting, expecting 12 assets, fixed at that time
```

### Requirement: Counters count blind

Counters SHALL NOT be able to see the expected list. They SHALL see only the places they count in and
how many items they have recorded there.

#### Scenario: A counter cannot read the expected list

```gherkin
Given Suresh counts the ATK count
When he asks for the count's expected list
Then he is refused
And his count page shows only his areas and how many he has recorded
```

### Requirement: Record what is found

A counter SHALL record each item by its tag as found here, damaged, idle, or found but belonging
elsewhere, with the area, and optionally its condition and a photo. A tag that cannot be scanned
SHALL be typed with a reason. An item not in the register SHALL be recorded with a description, the
area, any new tag stuck on it and a reason. Every record SHALL keep who made it and when, and a tag
recorded twice in one count SHALL be flagged as a duplicate.

#### Scenario: A damaged chiller

```gherkin
Given the ATK count is Counting and Suresh counts it
When he records the display chiller in ATK Dairy aisle as Damaged
Then the record keeps Suresh, the time, Dairy aisle and Damaged
```

#### Scenario: A typed tag needs a reason

```gherkin
Given the billing PC’s label is torn
When Suresh types its tag without a reason
Then the record is refused, asking why the tag was typed
```

#### Scenario: The same tag twice

```gherkin
Given Suresh recorded the billing PC once
When he records it again in the same count
Then the second record is flagged as a duplicate
```

### Requirement: Review shows every outcome

The count's reviewer SHALL see what was expected and, for each outcome, how many and which lines:
found here, damaged, idle, found elsewhere, missing, unlisted and duplicate. An expected asset that
was moved in the register after the count started SHALL show as moved, not as missing. Someone who
counted or recorded in a count SHALL NOT review it.

#### Scenario: Missing and moved are kept apart

```gherkin
Given the ATK count expected the weighing scale and the forklift
And the forklift was moved to Enchakkal after the count started
When neither is recorded
Then the review shows the scale as missing and the forklift as moved since the start
```

### Requirement: Send lines back for a recount

The reviewer SHALL be able to send missing lines back to the counters, who SHALL then be able to
record those items again.

#### Scenario: Recount the scale

```gherkin
Given the weighing scale is missing in the ATK review
When the reviewer sends it back for recount and Suresh then finds it
Then the scale shows as found
```

### Requirement: Every exception gets a decision, and nothing writes off

The reviewer SHALL decide every missing line (found later, mapping corrected, sent to Loss
Prevention, or proposed to Finance for retirement) and every unlisted line (to capitalize, a
controlled item, or third-party). A decision SHALL change nothing in the register or in SAP. A count
SHALL close only when every missing and unlisted line has a decision, and a closed count SHALL stay
closed.

#### Scenario: Close needs every decision

```gherkin
Given the ATK review has one missing line without a decision
When the reviewer closes the count
Then closing is refused, saying every missing and unlisted line needs a decision
```

### Requirement: An asset shows when it was last verified

An asset's page SHALL show when it was last recorded in a count and with what outcome.

#### Scenario: Last verified

```gherkin
Given Suresh recorded the display chiller as Damaged in the ATK count on 7 November 2026
When anyone opens the chiller’s page
Then it shows last verified 07-Nov-2026, Damaged, in the ATK count
```
