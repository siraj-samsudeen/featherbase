# Asset register

## Purpose
One register of the group's physical assets in Assets: what each asset is, where it is,
which legal entity owns and operates it, its SAP numbers and its JRA tag, so store staff,
technicians and Finance read the same record.

## Requirements

### Requirement: Keep one register of the group's assets

Each asset SHALL belong to one place and have a type. Its tag number SHALL be the JRA- tag stuck on
it, from the group's one tag series, and SHALL never change; the internal ID stays hidden. An asset
not yet tagged SHALL say it needs a tag. Every member SHALL be able to see the register.

#### Scenario: An AC in a store

```gherkin
Given ATK 1501 is one of the group's sites
When a manager adds the "Voltas 2-ton split AC" of type AC to ATK 1501 with tag JRA-000501
Then the register lists the AC under tag JRA-000501
And every member sees it in ATK 1501
```

#### Scenario: An asset not yet tagged

```gherkin
Given the "Billing PC, till 3" in ATK 1501 has no tag yet
When a member opens the register
Then the billing PC's tag reads "Needs a tag"
```

### Requirement: Places nest from site to area

A place SHALL be a site, a building, a floor or an area, and each place below a site SHALL sit
inside another place. An asset's place SHALL read as its full path from the site.

#### Scenario: A cold room deep inside a warehouse

```gherkin
Given the Cold chain area is on the Ground floor of the Main building at Enchakkal WH 9151
When a member opens the walk-in cold room in Cold chain
Then its place reads "Enchakkal WH 9151 › Main building › Ground floor › Cold chain"
```

### Requirement: Each asset links to its SAP records

An asset SHALL carry its SAP company code, asset number and sub-number, equipment number and legacy
ID, and when they were last refreshed from SAP. Assets SHALL show these as coming from SAP and
SHALL NOT offer to change them, because SAP is the record for them.

#### Scenario: SAP numbers on the asset page

```gherkin
Given the walk-in cold room is SAP asset 210004512, sub-number 0, equipment 10007731
When a member opens it in Assets
Then the page shows those numbers as coming from SAP, with when they were refreshed
And offers no way to change them
```

### Requirement: Ownership is recorded apart from location

Each asset SHALL record its legal owner and its operator as legal entities, its cost centre, and
its custodian, who is either an employee or a named custodian for a shared location. A legal
entity SHALL carry a mapping status of Draft, Verified, Held, Inactive or Closed.

#### Scenario: Owned by one company, run by another

```gherkin
Given KAIPL is a Verified legal entity and Kannammal Agro is another
When the walk-in cold room is owned by KAIPL and operated by Kannammal Agro
Then its page shows both, with KAIPL marked Verified
```

### Requirement: Four states are kept apart

An asset SHALL have a books state, a condition and a custody state, each set on its own, and a
workflow state that Assets works out from its open processes. Changing one SHALL never change
another.

#### Scenario: Capitalized, under repair and with a vendor at once

```gherkin
Given the walk-in cold room is Capitalized and Under repair, With vendor
And it has an open repair job
Then its page shows Books Capitalized, Condition Under repair, Custody With vendor and Workflow Repair job open
```

### Requirement: Only managers change the register

Only an Assets Manager SHALL be able to add or change assets, places, asset types and legal
entities.

#### Scenario: Store staff can look but not change

```gherkin
Given the "Voltas 2-ton split AC" is in the register
When store staff try to change its place
Then the change is refused
```

### Requirement: See what needs attention on an asset

The register SHALL show, for each asset, whether it has an open repair job and whether its
warranty ends within the next 30 days.

#### Scenario: A warranty about to end

```gherkin
Given today is 7 November 2026
And the "Kirloskar 62.5 kVA DG" warranty ends on 30 November 2026
Then the register shows its warranty ends soon
```
