# zone-codes.csv — claims

UPS-J2's fixture: a spreadsheet that already carries its own reference
codes. Three rows, three columns:

- **Code** → mapped onto the **Row ID** (UPS-R4): `REF-101` inserts
  verbatim; `REF-102` collides with a pre-seeded row (the J2 branch —
  fails by its true spreadsheet row on append, updates when Code is the
  match key); the **empty** code on Mike's row proves mixing — the series
  simply continues for unsupplied rows (IMP-R6).
- **Zone Name** / **Population** → ordinary mapped columns.
