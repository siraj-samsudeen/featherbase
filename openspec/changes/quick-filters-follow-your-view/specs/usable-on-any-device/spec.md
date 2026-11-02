# Usable on Any Device

## ADDED Requirements

### Requirement: Filters fold away on a phone

On a phone, a list's filter controls SHALL stay folded until the user opens them, so they don't push its rows down. The
folded control SHALL say how many filters are in use.

#### Scenario: Section Mapping's rows come straight after the folded filters

- **WHEN** the user opens the list of "Section Mapping" on a phone
- **THEN** no filter control shows, and the rows come straight after the folded filters
- **AND** opening the filters shows up to six quick filters, one above the other, says how many more there are, and
  lets the user add a filter

#### Scenario: The folded control says 2 filters are in use

- **WHEN** the user on a phone has filtered "Section Mapping" by Floor and by Owner, and the filters are folded
- **THEN** the user can see that 2 filters are in use
