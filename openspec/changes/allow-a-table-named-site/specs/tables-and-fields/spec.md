# Tables and Fields

## MODIFIED Requirements

### Requirement: A table's name is its own, ignoring letter case and spacing

Building a table SHALL be refused when its name matches an existing table's
name, or storage the platform itself uses, once letter case and spacing are
ignored. The list of sites an instance serves is kept apart from the
builder's tables, so "Site" stays free for a table of the builder's own.

#### Scenario: Same name in different letters

- **WHEN** a builder creates "audit owned" while a table "Audit Owned"
  already exists
- **THEN** the new table is refused and the existing one is unchanged

#### Scenario: A Site table holds the user's sites

```gherkin
Given no table is called "Site"
When the user creates a table "Site" and adds the site "Enchakkal"
Then the table shows "Enchakkal"
And the list of sites the instance serves is unchanged
```
