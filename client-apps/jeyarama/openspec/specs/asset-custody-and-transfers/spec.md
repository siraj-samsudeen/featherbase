# Asset custody and transfers

## Purpose
Who holds each asset, how it is handed over and taken back, clearance for people who leave
or move, and transfers between places and companies that are approved, scanned out and
received item by item.

## Requirements

### Requirement: Issue an asset and have it accepted

An Assets Manager SHALL be able to issue an asset to an employee, or to a named custodian for shared
equipment at a location. The issue SHALL stay pending until that person accepts it or says it is
not with them, and only that person SHALL be able to answer. An asset already in someone's custody
SHALL NOT be issued again until it is returned.

#### Scenario: Suresh accepts the billing PC

```gherkin
Given a manager issues the billing PC to Suresh
When Suresh accepts it
Then the billing PC is with Suresh, accepted
```

#### Scenario: Someone else cannot accept for him

```gherkin
Given the billing PC is issued to Suresh and waiting
When another member tries to accept it
Then the answer is refused, saying only Suresh can answer
```

### Requirement: Return an asset

A custodian SHALL be able to hand an asset back, and an Assets Manager at the site SHALL accept the
return, after which the asset is at its location with no custodian.

#### Scenario: Suresh hands the PC back

```gherkin
Given Suresh holds the billing PC
When he hands it back and a manager accepts the return
Then the billing PC is at its location with no custodian
```

### Requirement: Clear a leaving or moving employee

An Assets Manager SHALL be able to open a clearance for an employee who is leaving or moving, with
the leaving date, listing every asset they still hold. A clearance SHALL close only when each asset
is returned or reassigned. After the leaving date an open clearance SHALL show as needing
escalation to HR and Operations. Assets SHALL never hold pay or apply a penalty.

#### Scenario: Clearance needs every asset back

```gherkin
Given Suresh is leaving on 30 November 2026 and still holds the billing PC
When a manager tries to close his clearance
Then closing is refused until the PC is returned or reassigned
```

#### Scenario: Past the leaving date

```gherkin
Given Suresh left on 5 November 2026 and still holds the billing PC
When anyone opens his clearance on 7 November 2026
Then it shows that it needs escalation to HR and Operations
```

### Requirement: Request and approve a transfer

An Assets Manager SHALL be able to request a transfer of chosen assets from one place to another,
as a move within a site, between sites, a temporary loan, a repair with a vendor or a move between
companies, with a reason and an expected receipt time. The expected receipt time SHALL default to
24 hours within a site and 3 days otherwise, and MAY be changed. Someone other than the requester
SHALL approve or reject it. An asset already on an open transfer SHALL NOT be added to another.

#### Scenario: The requester cannot approve

```gherkin
Given Meena requests moving two ACs from ATK 1501 to Enchakkal WH 9151
When Meena approves her own request
Then the approval is refused, saying someone else approves
```

#### Scenario: One transfer at a time

```gherkin
Given the AC is on an approved transfer
When a manager adds the AC to another transfer
Then it is refused, saying the AC is already on a transfer
```

### Requirement: Dispatch scans every item out

Dispatching SHALL need every item scanned out and SHALL record the transporter or vendor. Each asset
SHALL then be in transit, or with the vendor for a repair.

#### Scenario: Dispatch the ACs

```gherkin
Given the transfer of two ACs is approved
When Meena scans both out with transporter "Sri Murugan Logistics"
Then both ACs are in transit, due within 3 days
```

### Requirement: Receive changes where an asset is

An Assets Manager at the destination SHALL receive each item as received good, received damaged, or
refused and sent back. An asset's place SHALL change only when it is received. A transfer past its
receipt time SHALL show as late.

#### Scenario: One received good, one damaged

```gherkin
Given two ACs are in transit to Enchakkal WH 9151
When a manager receives one as good and one as damaged
Then both ACs are at Enchakkal WH 9151 and the damaged one shows condition Damaged
```

#### Scenario: Late in transit

```gherkin
Given a transfer between sites was dispatched 4 days ago and is not received
Then it shows as late
```

### Requirement: Moves between companies wait for Finance

A transfer between companies SHALL show that it needs Finance and tax approval. Receiving it SHALL
NOT change the legal owner. The owner SHALL change only when someone other than the requester
confirms the SAP transaction for it, after receipt.

#### Scenario: Ownership waits for SAP

```gherkin
Given a transfer of the DG from JRPL to KAIPL is received
When nobody has confirmed the SAP transaction
Then the DG is still owned by JRPL
And once Finance confirms SAP document 4900012345 the DG is owned by KAIPL
```

### Requirement: An asset shows its custody and movements

An asset's page SHALL list who has held it and how it has moved, with dates.

#### Scenario: The PC's history

```gherkin
Given the billing PC was issued to Suresh and later moved to Enchakkal WH 9151
When anyone opens its page
Then it lists the issue to Suresh and the move to Enchakkal, each with its date
```
