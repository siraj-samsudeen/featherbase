# Asset labels

## Purpose
Printed tag labels that carry the group's JRA tag numbers and a QR code, so anyone can
scan an asset and open its page.

## Requirements

### Requirement: Print labels by tag range

A member SHALL be able to print labels for a range of tag numbers from the group's one tag series,
before any asset carries them, with no place to choose. Each label SHALL read "Jeyarama Group
property" and "Please do not remove", and carry the tag number in large print and a QR code for
that tag. This replaces the per-place label sheet, as the ATK 1501 tagging plan prints labels by
roll (change `jeyarama-assets-atk-tagging`).

#### Scenario: Labels for part of a roll

```gherkin
Given roll R-03 holds tags JRA-000301 to JRA-000400
When the user prints labels from JRA-000301 to JRA-000306
Then the sheet has six labels, JRA-000301 to JRA-000306
And each label reads "Jeyarama Group property" and "Please do not remove" and has a QR code
```

### Requirement: Scanning a label opens the asset

Scanning a label's QR code SHALL open the page of the asset that carries its tag. Someone not
signed in SHALL sign in first and then land on the same asset.

#### Scenario: Scan a label

```gherkin
Given the "Voltas 2-ton split AC" carries tag JRA-000301
When a member scans its label with a phone
Then the AC's page opens, with its place, warranty and any open repair job
```
