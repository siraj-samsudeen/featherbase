# Search and Explore

## MODIFIED Requirements

### Requirement: Explore chains tables and narrows them as you click

Explore SHALL let the user start from a Table and add up to four more, following References in either direction or child relationships. Clicking rows selects them and narrows every later Table; changing an earlier selection or path MUST clear later selections. With nothing selected, each stage follows the whole upstream result, not just the displayed rows, with exact counts and supported sums.

Opening a row from Explore SHALL use the same peek panel as a form's links rather than leaving Explore.

#### Scenario: Narrow by clicking

- **WHEN** the user starts Explore from Supplier, adds Purchase Order, clicks
  one supplier, then adds PO Line
- **THEN** Purchase Order narrows to that supplier's orders, and PO Line
  narrows to those orders' lines, with an accurate count and sum at every
  stage

#### Scenario: Open a row without leaving Explore

- **WHEN** the user opens one of the rows Explore is showing
- **THEN** it opens in the same peek panel a form's linked rows open in, and
  closing it returns to Explore unchanged

#### Scenario: A five-stage journey reaches the linked workers

```gherkin
Given synthetic sections lead through floor sections and assignment sections to assignments and workers
When the user explores those five stages from sections to workers
Then the final stage shows each reachable worker once
And no sixth stage can be added
```

#### Scenario: Releasing an earlier selection restores the workers

```gherkin
Given synthetic sections lead through floor sections and assignment sections to assignments and workers
When the user narrows the five-stage journey to North and then releases North
Then the final stage again shows all reachable workers
And opening a worker returns to the unchanged journey
```
