# Asset labels

## ADDED Requirements

### Requirement: Print a sheet of labels for one place

A member SHALL be able to print a sheet with one label for each asset in a chosen place. Each
label SHALL carry a QR code, the tag number, the asset's name and its place.

#### Scenario: Labels for one store

```gherkin
Given Avadi Store has the "Voltas 2-ton split AC" and the "Billing PC, till 3"
And Keelkattalai Store has the "Blue Star cold room"
When the user prints the label sheet for Avadi Store
Then the sheet has a label for the AC and one for the billing PC
And no label for the cold room
```

### Requirement: Scanning a label opens the asset

Scanning an asset's QR code SHALL open that asset's page. Someone not signed in SHALL sign in
first and then land on the same asset.

#### Scenario: Scan a label

```gherkin
Given the "Voltas 2-ton split AC" has a printed label
When a member scans it with a phone
Then the AC's page opens, with its place, warranty and any open repair job
```
