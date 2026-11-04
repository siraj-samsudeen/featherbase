# Tables and Fields

## ADDED Requirements

### Requirement: A table can be called Site

Building a table named "Site" SHALL succeed. The platform keeps its own list
of the sites an instance serves apart from the builder's tables, so the name
is free to use and that list is left unchanged.

#### Scenario: A Site table holds the builder's sites

- **WHEN** a builder creates a table "Site" and adds the site "Enchakkal"
- **THEN** the table shows "Enchakkal", and the platform's own list of sites
  is unchanged
