# Design

## Scope sources

A reader's material groups are the union of four sources, each optional:

| Source | Basis shown |
| --- | --- |
| Explicit Sales Target Assignment rows | `assignment` |
| Employee Section Map rows for the reader's employee code | `section_staff` |
| Section Ownership rows naming the reader as TL, current on today | `team_leader` |
| Section Ownership rows naming the reader as DM (`dm_employee_code`), current on today | `department_manager` |

Leadership reads the whole Section. A TL's own Employee Section Map rows are a sliver of their Section on the real ATK data (2 of 90 groups for one TL), so using them alone under-reports what the TL is accountable for.

Section Ownership is versioned per Section by `effective_from`. A Section's current rows are its latest `effective_from` on or before today. A per-store rule was tried first and was wrong: two Sections handed over on 06-Aug made every July row look superseded, leaving 2 of 64 readers.

Roster Section names differ from merchandise Section names. Section Name Alias can map one roster Section to several merchandise Sections (Home Décor & Stationery is Home Décor plus Stationery), so every alias row counts, as does the roster name itself.

One store per reader stays the rule. A conflict across sources is refused rather than mixed.

## Period

`currentPeriod()` is the first of the IST month through today in IST, resolved per request. `SALES_TARGET_TODAY` pins today for tests, demonstrations and reproducing a complaint.

## Snapshot identity

The dataset version becomes `<definition revision>:<period start>`, read through a getter. On the 1st a September snapshot is simply "not built under this definition". The existing path then serves live, records a miss, and the next refresh builds October. The same version filter keeps September out of the >50% drop guard, so the first small October build is not refused.

## Section grouping

The host sends `section_by_material_group` in the Dive's starting state; the Dive groups and subtotals by it and never queries by it. The pre-generated report computes Section subtotals server-side with the same arithmetic as the grand total.
