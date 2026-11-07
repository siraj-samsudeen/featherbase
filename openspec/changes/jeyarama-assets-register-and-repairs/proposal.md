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
- A printable sheet of QR labels for one place. Scanning a label opens that asset's page.
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

Not included: offline count packs, RFID, importing a count sheet, custody hand-over and transfers
(step 3), a live SAP
connection, capitalization, depreciation and anything else SAP owns, reporting without signing in
or by WhatsApp, scheduled servicing, sensors, and adding the app to the live Jeyarama instance.

## Capabilities

### New Capabilities

- `asset-register`: places, asset types, assets and who may change them.
- `asset-labels`: the QR label sheet and what scanning a label opens.
- `asset-repair-jobs`: reporting a fault, the fix-by clock, and moving a job to fixed.
- `asset-verification-counts`: planning a count, the fixed expected list, blind recording, review,
  recount and decisions.

### Modified Capabilities

None.

## Impact

- A new client app, Assets 0.1.0, with three roles: Assets Member, Assets Technician and Assets
  Manager. Installing it admits nobody.
- `pnpm apps:prepare` builds it for the tests.
- A new dependency in the app only: `qrcode`, to draw the labels.
