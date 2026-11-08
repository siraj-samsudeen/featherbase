## Why

Jeyarama Group runs ACs, cold rooms, generators, billing terminals, fixtures and vehicles across
its Chennai stores and warehouses. Nobody can see in one place what the group owns, where it is,
when its warranty ends, or which faults are waiting for a technician. The owner looked at
Asset Infinity and asked for an asset app in Featherbase. They picked the core first: a register,
QR labels, and fault reports that become repair jobs with a deadline.

The group's Asset Management BRD (v1.1, 7 November 2026) then set the direction: SAP S/4HANA stays
the record for the books and the equipment, and a thin layer handles QR scans, custody, counts,
transfers and evidence. Assets follows that: it links to SAP numbers and does not try to replace
SAP. Requirement IDs below are the BRD's.

## What Changes

- A new Jeyarama app, Assets (`client-apps/jeyarama/equipment`, served at `/equipment/`; the
  name `assets` is reserved by the platform).
- A register of assets, each tied to a store, warehouse or office, with its type, area, make,
  model, serial number, purchase date and cost, warranty end and photo. Managers keep it in
  Featherbase's own list and form, so filters, saved views and spreadsheet import come for free.
- QR labels printed by tag range. Scanning a label opens that asset's page. (This change first
  promised a sheet of labels for one place; `jeyarama-assets-atk-tagging` replaced it with
  printing by roll, as the ATK 1501 tagging plan does.)
- On an asset's page, staff report a fault. Each report becomes a repair job with a fix-by time:
  Urgent within 4 hours, High within a day, Normal within 3 days.
- A repair jobs board by stage. Managers and technicians assign jobs and move them on. A job is
  fixed only with a note of the work done, and it can record the cost.
- Each asset links to its SAP company code, asset number and sub-number, equipment number and
  legacy ID, shown as coming from SAP (ORG-01). Until a live SAP extract is connected, these are
  filled by importing an SAP export.
- Four separate states: books, condition, custody, and a workflow state worked out from open
  processes (DAT-04).
- Legal entities with a mapping status; each asset records its legal owner, operator, cost centre
  and custodian (ORG-02, DAT-01/02). Places nest from site to building, floor and area.
- Repair jobs keep their whole timeline, cause, spares and outside service; someone other than the
  technician confirms the repair before the job closes; cover under warranty or AMC is shown
  (MNT-02, MNT-04).
- Development sample data for the BRD's pilot: ATK 1501, Enchakkal WH 9151 and a Chennai store.
  Its SAP numbers are made up.

- Physical verification counts (VER-01..03): a manager plans a count of a site or place with its
  counters and a separate reviewer; starting it fixes the expected list; counters record blind;
  the reviewer sees found, missing, moved, unlisted and duplicate lines, sends lines for recount,
  and decides every exception before the count closes. Nothing writes off or touches SAP.

- Custody and transfers (PHY-01..05): issue to an employee or location custodian with acceptance,
  returns, clearance for leavers, and transfers within a site, between sites, on loan, to a vendor
  for repair or between companies, each approved by someone other than the requester, scanned out
  and in, with receipt deadlines. An asset's place changes only on receipt; its owner changes only
  after Finance confirms the SAP transaction. The custodian is kept as a person ID.

Not included: offline count packs, RFID, importing a count sheet, a StyleHR feed, offline scans,
disposal gate passes, a live SAP
connection, capitalization, depreciation and anything else SAP owns, reporting without signing in
or by WhatsApp, scheduled servicing, sensors, and adding the app to the live Jeyarama instance.

## Capabilities

### New Capabilities

- `asset-register`: places, asset types, assets and who may change them.
- `asset-labels`: printing QR labels by tag range and what scanning a label opens.
- `asset-repair-jobs`: reporting a fault, the fix-by clock, and moving a job to fixed.
- `asset-verification-counts`: planning a count, the fixed expected list, blind recording, review,
  recount and decisions.
- `asset-custody-and-transfers`: issue and acceptance, returns, clearance, and transfers from
  request to receipt.

### Modified Capabilities

None.

## Impact

- A new client app, Assets 0.1.0, with three roles: Assets Member, Assets Technician and Assets
  Manager. Installing it admits nobody.
- `pnpm apps:prepare` builds it for the tests.
- A new dependency in the app only: `qrcode`, to draw the labels.
