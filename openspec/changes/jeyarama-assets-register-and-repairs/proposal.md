## Why

Jeyarama Group runs ACs, cold rooms, generators, billing terminals, fixtures and vehicles across
its Chennai stores and warehouses. Nobody can see in one place what the group owns, where it is,
when its warranty ends, or which faults are waiting for a technician. The owner looked at
Asset Infinity and asked for an asset app in Featherbase. They picked the core first: a register,
QR labels, and fault reports that become repair jobs with a deadline.

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
- Development sample data with Jeyarama's places, about twenty assets and a few jobs.

Not included: reporting without signing in, reporting by WhatsApp, scheduled servicing, sensors,
and adding the app to the live Jeyarama instance.

## Capabilities

### New Capabilities

- `asset-register`: places, asset types, assets and who may change them.
- `asset-labels`: the QR label sheet and what scanning a label opens.
- `asset-repair-jobs`: reporting a fault, the fix-by clock, and moving a job to fixed.

### Modified Capabilities

None.

## Impact

- A new client app, Assets 0.1.0, with three roles: Assets Member, Assets Technician and Assets
  Manager. Installing it admits nobody.
- `pnpm apps:prepare` builds it for the tests.
- A new dependency in the app only: `qrcode`, to draw the labels.
