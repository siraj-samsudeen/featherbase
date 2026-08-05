# Importing a spreadsheet

<!--
  GENERATED VIEW (exemplar) — rendered from the journey layer of
  docs/design/requirements-framework.md (IMP-J1/J2/J3).
  This first version is hand-rendered to fix the target output; the
  generator is adoption work.

  Slot contract: every screenshot lives at docs/manual/shots/<step-id>.png.
  While a slot's PNG does not exist, the ASCII sketch below it is shown.
  Running the journey's e2e test with SNAP=1 writes real screenshots into
  the slots; the ASCII stays in this file as the permanent fallback and
  the record of the original design intent.
-->

Bring a spreadsheet in and Featherbase turns it into a Table — columns
typed, rows numbered, ready to use. If the Table already exists, the same
screen appends your rows to it.

---

## Your first import: a file becomes a new Table

### 1 · Open the import screen

Click **Import Data** in the sidebar. You'll see an empty drop area.

<!-- slot: IMP-J1.1 → shots/IMP-J1.1.png -->
```
┌────────────┬──────────────────────────────────────┐
│  Sidebar   │                                      │
│  …         │      ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐        │
│ ▸ Import   │        Drop a CSV or Excel           │
│   Data     │      │ file here, or browse  │       │
│  …         │      └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘        │
└────────────┴──────────────────────────────────────┘
```

### 2 · Drop your file

Drag your file onto the drop area. Featherbase reads it immediately and
shows one card per sheet with the counts it found — *these describe your
file*, nothing has been imported yet.

<!-- slot: IMP-J1.2 → shots/IMP-J1.2.png -->
```
┌──────────────────────────────────────────────────┐
│  zones.csv · 1 sheet                             │
│  ┌────────────────────────────────────────────┐  │
│  │ Sheet 1          8 rows, 6 columns in file │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

Only CSV and Excel files are accepted — anything else is refused by name
(*notes.pdf: not a CSV or Excel file*) and nothing changes.

### 3 · Check the target

The card shows where the rows will go. With no matching Table in your
system, it reads **New Table…** with a name suggested from the file —
`zones.csv` becomes **Zones**. You can rename it before importing.

<!-- slot: IMP-J1.3 → shots/IMP-J1.3.png -->
```
Import into:  [ New Table…            ▾ ]
Table name:   [ Zones                   ]
```

> If a Table matching your columns already exists, it is selected for you
> — with a visible notice that rows will be **added** to it, never
> silently. A partial match is only suggested; you decide.

### 4 · Review the columns

Featherbase guesses a type for every column from its values. Review the
grid — every row is editable before you commit.

<!-- slot: IMP-J1.4 → shots/IMP-J1.4.png -->
```
│ Column      │ Label      │ Type     │ Choices        │
│ zone_name   │ Zone Name  │ Data     │                │
│ region      │ Region     │ Choice   │ North, South   │
│ population  │ Population │ Int      │                │
│ area_sq_km  │ Area Sq Km │ Float    │                │
│ opened_on   │ Opened On  │ Date     │                │
│ is_active   │ Is Active  │ Check    │                │
```

Repeated values (North, South) become a fixed choice list; yes/no columns
become tick boxes; dates stay dates whatever timezone your server runs in.

### 5 · Check the Row ID

Each imported row gets a readable id in a series named after your Table —
here `ZONES-###`. This row is locked; rename the Table and the series
follows.

<!-- slot: IMP-J1.5 → shots/IMP-J1.5.png -->

### 6 · Import

The button already tells you what will happen: **Import 8 rows**. Click
it and watch the progress.

<!-- slot: IMP-J1.6 → shots/IMP-J1.6.png -->

If a cell can't be converted into a column whose type is already fixed —
appending to an existing Table, or after you set the type yourself — that
row is skipped and reported **by its spreadsheet row number** so you can
find it in Excel; the other rows still import. (On a brand-new Table,
one odd value simply makes that column infer as plain text instead.)

### 7 · See your data

You land in the **Zones** list with all eight rows, each carrying its
`ZONES-…` id.

<!-- slot: IMP-J1.7 → shots/IMP-J1.7.png -->

### 8 · Open a row

Values are properly typed, not text: Region is a dropdown offering exactly
North and South, Is Active is a real yes/no control, and Opened On is
still the calendar day from your file.

<!-- slot: IMP-J1.8 → shots/IMP-J1.8.png -->

### 9 · The import record

The import history shows one entry for this run: the Table, the file
name, rows inserted, rows failed, and that the Table was created by this
import.

<!-- slot: IMP-J1.9 → shots/IMP-J1.9.png -->

---

## Adding rows to an existing Table

The same screen, three differences:

- The matching Table is **already selected**, with a notice that rows
  will be **added** to it. <!-- slot: IMP-J2.3 → shots/IMP-J2.3.png -->
- You can **rehearse first**: validate every row against the Table and
  see exactly which would fail — without writing anything.
  <!-- slot: IMP-J2.6 → shots/IMP-J2.6.png -->
- After importing, your existing rows are untouched; the file's rows are
  appended.

Starting from a Table's own **Import** button pre-selects that Table.

## Workbooks with several sheets

Each populated sheet gets its own card with its own target and column
grid — import them independently, skip any sheet, drop any column. Empty
sheets are ignored. <!-- slot: IMP-J3.1 → shots/IMP-J3.1.png -->

---

*This page is a generated view of the Spreadsheet Import journeys in
`docs/design/requirements-framework.md`. Screenshots are produced by the
journey tests (`SNAP=1`); a sketch instead of a screenshot means that step
has not yet been proven in a browser on this commit.*
