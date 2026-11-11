# Jeyarama Assets tagging

## Purpose
The fresh ATK inventory: one permanent JRA tag series, tagged count sheets with two
initials per line, the daily area close, a movement freeze, SAP matching and exceptions
approved by Finance.

## Requirements

### Requirement: One permanent tag series

A tagged asset SHALL carry a tag of `JRA-` and six digits from an issued tag roll. A tag SHALL
NOT be used twice, reused after it was spoiled, or changed once set.

#### Scenario: A used tag is refused

```gherkin
Given JRA-000123 is on the dairy chiller
When a counter records another item with JRA-000123
Then the line is refused, saying tag numbers are never reused
```

### Requirement: Record a fresh count line by area

During a fresh inventory count, a counter SHALL record one line per item in an area, initialled
by the counter and a second team member. Bulk items SHALL be one line with a quantity and no
tag. A third-party item SHALL name its owner and carry no group tag unless Finance approves.

#### Scenario: Both initial

```gherkin
Given Ravi and Meena count ATK area GF-A03
When Meena records JRA-000123 tagged by Ravi
Then the line shows tagged by Ravi and recorded by Meena
```

### Requirement: Close an area each day

The site manager SHALL sign an area's day only when the labels used equal the tagged lines plus
spoiled labels.

#### Scenario: A missing label

```gherkin
Given 3 tagged lines and no spoiled labels in GF-A03 today
When the site manager signs with 4 labels used
Then it is refused, saying to find the difference first
```

### Requirement: Freeze movement during the count

While a fresh count's freeze dates cover today, a transfer into or out of its site SHALL need the
site manager's written note.

#### Scenario: Transfer during the freeze

```gherkin
Given ATK 1501's count freeze runs from yesterday to tomorrow
When a manager requests a transfer out of ATK 1501 without the site manager's note
Then it is refused, saying ATK 1501 is in its count freeze
```

### Requirement: Match the SAP book separately from counting

Only an asset accountant who did not count SHALL match SAP records to tags, recording the method.
A description-based match SHALL need a second person's check. One record SHALL be able to link
to several tags, and its book value SHALL be shared across them.

#### Scenario: A counter cannot match

```gherkin
Given Ravi counted at ATK 1501
When Ravi matches a SAP record
Then it is refused
```

### Requirement: Approve exceptions independently

An exception SHALL be approved only by a Finance Controller who is not an asset accountant, did
not raise it, and did not count. The reconciliation SHALL show the book match rate, value not
yet found, items found but not in the books, tag coverage and open exceptions.

#### Scenario: The accountant cannot approve a write-off

```gherkin
Given an "In books, not found" exception raised by the asset accountant
When the asset accountant approves it
Then it is refused
```
