## Why

ATK 1501 is the pilot for a fresh, blind count. The team tags every asset with a permanent QR
number and records it, the asset accountant matches the count to the SAP book, and Finance
decides every difference (ATK 1501 Asset Inventory and Tagging Plan, 7-Nov-2026, from the Asset
Management BRD v1.1). The owner found the Assets screens "not aligned" to that plan and approved
fixing all 22 gaps ("Fix all ticked"). They chose a Tasker project for the plan's seven phases.

## What Changes

- **Tags.** A tag is `JRA-` plus six digits, from one group series that is never reused. Labels
  print by roll and show "Jeyarama Group property", a do-not-remove line, the tag in large print
  and a QR code that opens the asset by its tag. A tag roll log keeps first and last numbers,
  team, used, returned and spoiled numbers. Spoiled or skipped numbers and reprints are logged
  with a reason.
- **Four labels per item.**
  - Asset class follows SAP, with a class code Finance confirms.
  - Asset type carries its class, sticker kind, counting note and whether Engineering maintains
    it.
  - Control category is set only by Finance.
  - Ownership records the owner's name. Third-party items carry no group tag unless Finance
    approves.
- **Fresh count.** A "Fresh inventory" count records one line per item:
  - tag, type and description
  - make, model and serial
  - condition, usage, ownership and custodian
  - a photo
  - both team members' initials
  Bulk items take one line with a quantity. Areas have codes and custodians, and sites have a
  site manager. Each day the site manager closes an area: the labels used must equal the tagged
  lines plus spoiled labels. During the count dates, a transfer into or out of the site needs the
  site manager's written note.
- **Independent recount.** The Finance Controller starts a recount of a 10% sample plus every
  item at or above their value threshold. The error rate is shown.
- **SAP matching.** The SAP book extract for the plant is held only by asset accountants. Each
  match records its method:
  - serial
  - old tag
  - invoice or PO
  - description, place and capitalization date, which needs a second person to check
  One SAP record can link to several tags, and matching copies the book value to the assets.
  Each record shows Found, Found n of m, Not found yet or Check tag no.
- **Exceptions and reconciliation.**
  - The exceptions log covers six outcomes, each with an owner, due date, approval reference and
    state.
  - Only a Finance Controller who is neither an asset accountant nor on the count team approves.
  - The count team never matches.
  - A reconciliation page shows the book match rate, value not yet found, items found but not in
    the books, tag coverage and open exceptions.
- **Pilot phases.** A setup script creates the seven-phase pilot as a Tasker project, one dated
  task per phase, with its output and sign-off.

## Capabilities

### New Capabilities

- `jeyarama-assets-tagging`: tags, labels, the four labels, fresh counts, area close, the
  movement freeze, recount, SAP matching, exceptions and reconciliation.

### Modified Capabilities

None.

## Impact

- Equipment 0.2.0, with a migration from 0.1.1. It adds new Tables, columns on assets, types,
  places, counts, scans and transfers, and two roles: Assets Accountant and Assets Finance
  Controller.
- Sample data for ATK 1501, with SAMPLE SAP numbers.
