# Table definitions

**A draft for the owner to challenge. Nothing here is decided or built.** Written on 20 November 2026.

A Table definition is one small JSON document that says what a Table is: its name, its Columns, what
tells its rows apart, and what it belongs to. This draft proposes what that document looks like.

It comes from three places:

- The old vision, which the owner kept as an input on 20-Nov: Table definitions are portable JSON, and
  an AI chat, a person working by hand and a developer are equal ways in.
- `BIG-PICTURE.md` and `APPS-AND-SHARING.md` on this branch.
- The owner's answers in the first-principles review of 19 and 20 November. Those are not yet written
  into this branch. Where this draft leans on one, it says so in words.

Working examples are in `samples/table-definitions/`. All names and rows in them are made up.

## 1. The whole idea in one picture

There is one document, and three ways to make it.

```
by hand on the screens  ─┐
an AI chat, through MCP ─┼─►  a Table definition  ─►  check  ─►  show what would change
a file in a package     ─┘                                              │
                                                             a person confirms
                                                                        │
                                                              Postgres is changed
```

- A person fills in a screen. Each control on the screen is one field of the definition.
- An AI chat writes the same document and hands it over through MCP.
- A developer keeps the same document as a file in a package.

After that, all three go down one road. Featherbase checks the definition, compares it with what exists,
shows what would change, and changes nothing until a person confirms.

The import already works this way. When a person uploads `employees.csv`, the proposal on the screen
**is** a Table definition that Featherbase wrote from the file. So the import, the screens, the AI chat
and a package all meet at the same point.

## 2. The smallest example

This is what the import would propose for `samples/employees/employees.csv`.

```json
{
  "format": "featherbase.table/1",
  "name": "masters.employees",
  "label": "Employees",
  "title": "name",
  "key": ["employee_code"],
  "columns": [
    { "name": "employee_code", "label": "Employee Code",
      "type": "Text", "required": true },
    { "name": "name", "label": "Name",
      "type": "Text", "required": true },
    { "name": "department", "label": "Department",
      "type": "Choice",
      "choices": ["Accounts", "Billing", "Sales",
                  "Stores", "Tailoring"] },
    { "name": "date_of_joining", "label": "Date of Joining",
      "type": "Date", "required": true },
    { "name": "date_of_leaving", "label": "Date of Leaving",
      "type": "Date" },
    { "name": "active", "label": "Active", "type": "Yes/No" },
    { "name": "weekly_hours", "label": "Weekly Hours",
      "type": "Number" }
  ]
}
```

Everything in it is a word a person already sees on the screen: Table, Column, Key, Choice, Text,
Number, Date, Yes/No. There are no developer words and no codes.

## 3. What a Table can say about itself

**`format`**: always `featherbase.table/1`. It tells any reader, today or in two years, which rules
this document follows.

**`name`**: the Table's address, written `area.table`. The area is `masters`, or a package's name such
as `helpdesk`. A name with no area means "wherever the person puts it", which is how a Table brought
into a work area would be written.

**`label`**: what people see. If it is left out, it is made from the name.

**`about`**: one or two plain sentences on what the Table is. People see it as help. An AI chat reads it
to understand the Table before it touches it. It could later feed the Glossary.

**`title`**: the Column that stands for a row when another Table links to it. A Section that links to a
Site shows "Lakeside", because Site's title is `site_name`.

**`key`**: the Columns that tell rows apart, one or several. It is optional. The owner's answer of
19-Nov was that an import must never be made hard, so no key is demanded up front. Every row has
Featherbase's own `_id` anyway. The key is what a re-import uses to match rows.

**`columns`**: the Columns, in the order people see them.

**`belongs_to`**: what a row hangs off. This is what access by place is built on. See section 5.

**`dated`**: says the Table's rows each hold for a period. See section 6.

**`formerly`**: the names this Table used to have. See section 8.

## 4. What a Column can say about itself

**`name`**: the Column's name in the database, lower case with underscores.

**`label`**: what people see. If it is left out, it is made from the name.

**`about`**: plain help text, for people and for an AI chat.

**`type`**: one of six words.

- `Text`
- `Number`: one exact decimal type
- `Date`: a day, written `2015-01-01`
- `Yes/No`
- `Choice`: a value from a short list, given in `choices`
- `Link`: a row of another Table, named in `to`

More types will be needed (long text, date and time, a file). Each one is added as a word that also
appears on the screens.

**`required`**: the Column may not be blank.

**`choices`**: the list, for a Choice.

**`to`**: the Table a Link points at.

**`dated`**: for a Link whose value changes over time. See section 6.

**`formerly`**: the names this Column used to have. See section 8.

That is the whole list. Featherbase's own Columns (`_id`, `_created_at`, `_updated_at`) are never
written in a definition, because every Table has them.

## 5. What a row belongs to

On 20-Nov the owner chose this: each Table states **once** what it belongs to, and access rules then
only say "in their area". This is where it is stated. (Labels are left out below to keep it short.)

```json
{
  "format": "featherbase.table/1",
  "name": "masters.section",
  "label": "Section",
  "title": "section_name",
  "key": ["site", "section_name"],
  "columns": [
    { "name": "site", "type": "Link",
      "to": "masters.site", "required": true },
    { "name": "section_name", "type": "Text",
      "required": true },
    { "name": "floor", "type": "Link",
      "to": "masters.floor" },
    { "name": "department", "type": "Link",
      "to": "masters.department", "dated": true }
  ],
  "belongs_to": [
    { "by": "site" },
    { "by": "floor" },
    { "by": "department" }
  ]
}
```

Read aloud: *a Section belongs to a Site by `site`, to a Floor by `floor`, and to a Department by
`department`.*

**How the gate uses it.** Selvi is Store Manager at Lakeside. The rule says "Store Managers can edit
Sections in their area". Her place is a Site. The gate looks in Section's `belongs_to` for a way to a
Site, finds `site`, and adds one filter:

```
select * from section
where site in (her sites)
```

A floor manager gets the same filter on `floor`. A department manager gets it on `department`. Nobody
writes a path into a rule.

**Longer ways are followed, not written.** Section says nothing about clusters. Site does:

```json
"belongs_to": [
  { "by": "region" },
  { "by": "cluster" }
]
```

So for a cluster manager the gate goes Section, then Site, then Cluster, by following each Table's own
statement. Each Table states only its own next step.

**The row can also belong to a person.** A Ticket has `"belongs_to": [{ "by": "site" }, { "by":
"raised_by" }]`. The first serves "tickets in my store". The second serves "tickets I raised".

**Listing is choosing.** A Ticket also has an `assigned_to` Column, and it is left off the list on
purpose. A stock transfer has a from-site and a to-site; whoever designs it lists one or both. A Link
that is not listed never opens a row to anyone.

### When the link is its own Table

Sometimes the connection between two Tables is a Table of its own, with its own Columns. A Job
Assignment says a person does a job at a site, from a date until a date, and whom they report to.

Person then says:

```json
"belongs_to": [
  { "to": "masters.site",
    "through": "masters.job_assignment",
    "from": "person", "onward": "site" },
  { "to": "masters.person",
    "through": "masters.job_assignment",
    "from": "person", "onward": "reports_to" }
]
```

Read aloud: *a Person belongs to a Site through Job Assignment, and to another Person (their manager)
through Job Assignment's `reports_to`.* The first serves "people in my store". The second serves "my
team".

`from` and `onward` name the two Columns of the Table in the middle. They can be left out when that
Table has exactly one Link to each side. When there are two, as here with `person` and `reports_to`,
they must be written, and Featherbase refuses a definition that leaves it to a guess.

### Two things at once

A buyer holds a kind of merchandise **in** a region. Nothing new is needed in the definition for that.
A Sales row belongs to a Subcategory by one Column and reaches a Region through its Site. The gate asks
for both to match. That is the gate's work, not the Table's.

### What is not stated here

- **Who holds which place.** That a person is Store Manager at Lakeside comes from the shared roles
  package, not from a Table definition.
- **What a role may do.** "Store Managers can edit Sections in their area" lives in the one rule list
  in the platform.
- **Which way counts when two ways lead to the same place** (a Site reaches a Region directly and also
  through its Cluster). That question is open in the planning session and is not re-asked here.

## 6. Things that change over time

The owner's real masters are full of "who or what belonged where, and from when". Two shapes cover
them.

### A Link that changes over time

A Section sits in one Department today, and it has moved between Departments in the past. One word on
the Column says so:

```json
{ "name": "department", "type": "Link",
  "to": "masters.department", "dated": true }
```

What this would mean:

- On the screen, in filters and in access rules, `department` is an ordinary Column showing today's
  value.
- Behind it, Featherbase keeps every past value with the day it started and the day it ended.
- Changing the value asks "from which day?", ends the old period and starts the new one.
- A report can ask for the value "as of 30-Sep-2026".

In Postgres this would be the plain Column on the Table, holding today's value, plus one history table
beside it. Both are plain tables with real columns, so the warehouse reads them like any other.

This was noted as an idea on 20-Nov and not decided. It is in this draft because it makes the
department manager's rule as simple as the floor manager's.

### A Table whose rows are dated

A Job Assignment carries more than a link: a job title, a manager. It stays a Table of its own, and
says which two Columns hold its period:

```json
"dated": { "starts": "starts_on", "ends": "ends_on" }
```

What this would mean:

- A row is current when today falls inside its period. A blank end means "still running".
- Anything that goes **through** this Table (section 5) uses only its current rows.
- Lists show current rows first and can show the past. Reports can ask "as of".

## 7. How each of the three uses it

### By hand

The "new Table" screen and the import proposal are both an editor for this document. A person never
has to see JSON. Two small additions make the document visible to those who want it:

- **Download definition** on any Table.
- **Paste a definition** as a way to start a new Table, or to change one.

### An AI chat

Through MCP, the same as a program would do it:

1. Read a Table's definition, or all of them.
2. Hand over a new or changed definition.
3. Get back what would change, or a plain refusal that names the field.
4. A person confirms. Nothing is created before that.

What makes the format easy for an AI to get right:

- A small, closed set of words, and the same words as the screens.
- `about` on every Table and Column, so it can understand a Table it did not make.
- A published checker file (`table-definition.schema.json`), so a mistake is caught before a person
  ever sees it.
- Refusals in everyday words: *"`floor` is listed under belongs_to but it is not a Link."*

### A developer

One file per Table in the package's folder, for example `helpdesk/tables/ticket.json`.

- A deploy compares the files with what is installed and applies the difference. Adding a Table or a
  Column needs nothing else written (`APPS-AND-SHARING.md`, decision 19).
- A change to one Table is a small change to one small file, easy to review.
- There is no version chain and no migration history in the file.

### One round trip, as a promise

Download a definition, apply it to an empty instance, download it again: the two files are identical,
byte for byte. That needs one fixed way of writing the document (the order of fields, the spacing,
defaults left out). It is also what lets a Table move from a work area, to `masters`, to a package
without its data moving: only `name` changes.

## 8. Changing a Table that already has rows

The comparison can guess most changes. A few it must never guess.

- **A new Column or Table:** applied.
- **A changed label, help text or choice list:** applied.
- **A rename:** the definition says what the old name was.

  ```json
  { "name": "date_of_joining",
    "formerly": ["joining_date"], "type": "Date" }
  ```

  Without `formerly`, Featherbase would see one Column gone and a new one arrived, and would lose the
  values. With it, the Column is renamed in place. The name history that `BIG-PICTURE.md` describes is
  written from it, so the warehouse can follow the rename.
- **A Column missing from the definition:** never removed quietly. The preview says "this would remove
  `weekly_hours`, which has 24 values", and a person must say yes to that line.
- **A changed type:** refused unless every value fits the new type, like the import's own rule.

Every one of these is shown before it is applied, whoever asked: a person, an AI chat or a deploy.

## 9. What is deliberately not in the document

- **Rows.** A definition holds shape and meaning. Starting rows a package ships are a separate thing.
- **Access rules.** They live in the platform's one rule list. A package ships its starting rules
  beside its Tables, not inside them.
- **Ids.** `_id` values belong to one instance. A portable document uses names.
- **Pages and layout.** The order of the Columns is the default layout. Anything more is a later
  question.
- **Flows, calculated Columns, default values, checks before a save.** All real needs, none designed
  yet. The `format` field is what lets them be added later without breaking old documents.
- **Where an outside Table is copied from.** `BIG-PICTURE.md` gives every Table a source part and a
  Featherbase part, and one owner per Column. That needs its own fields (which connection, which
  outside table, which Columns the source owns). Left for when copying is planned.

A Column that one package adds to another package's Table (`APPS-AND-SHARING.md`, decision 10) would
use the same Column object in a small document of its own that names the Table it adds to. Not drawn
in detail here.

## 10. Candidate sentences

Written the way this branch writes them, for the day this is built. Each would have one test.

1. A definition that passes the check and is confirmed becomes a Table with one Column per entry.
2. A definition with a mistake is refused, and the refusal names the field.
3. Nothing is created or changed until a person confirms.
4. The definition downloaded from a Table, applied to an empty instance, downloads the same again.
5. A Column renamed with `formerly` keeps its values.
6. A Column missing from a new definition is removed only when a person agrees to that line.
7. A Link that is not listed under `belongs_to` gives nobody a row.
8. A way through another Table is refused when it could be read two ways.
9. A way through a dated Table uses only its current rows.
10. A dated Link shows today's value and keeps the earlier ones with their dates.

## 11. Questions for the owner

To be taken one at a time.

1. **JSON, against "readable code over large JSON".** The old vision calls JSON definitions the crown
   jewels. `APPS-AND-SHARING.md` section 10 records that the owner prefers readable code to large JSON.
   *Proposed:* JSON is the one portable form, kept small by having one file per Table and nothing in it
   but shape and meaning. The old pain was one 3,500-line manifest, nearly half of it migration
   history; none of that exists here. Code may write the document, but nobody needs code to make a
   Table.
2. **Must every way to a place be written, or are plain Links counted automatically?** *Proposed:*
   written, as in section 5, and the screens and the AI chat tick the likely ones for the person. Then
   adding a Link never opens rows to anyone by surprise.
3. **Is a Link that changes over time a built-in kind of Column** (section 6)? *Proposed:* yes.
4. **Are renames carried by `formerly` in the definition,** or by a separate named step? *Proposed:*
   `formerly`, shown in the preview like every other change.
5. **The words** `title`, `about`, `belongs_to`, `dated`, `formerly`, `through`, `onward`. Each is a
   word people will see. None is approved.
6. **Does the definition carry any layout** (which Columns show in a list, how a form is grouped), or
   does that live elsewhere?
7. **For a Table in `masters`, which is the master copy:** what is in the instance, or a file?
   *Proposed:* the instance. For a package's Table it is the package's file.

## 12. How this draft was checked

- `samples/table-definitions/table-definition.schema.json` is a draft checker for the format, in
  JSON Schema.
- All ten sample definitions pass it. Five deliberately wrong Columns are refused by it (a Choice with
  no list, a Text with a `to`, a Link with no `to`, and two reserved names).
- Every `title`, `key`, `belongs_to` and Link in the samples was also checked to point at something
  that exists.

To run the first check yourself:

```
pip install check-jsonschema
cd samples/table-definitions
check-jsonschema --schemafile table-definition.schema.json \
  employees.json region.json cluster.json site.json floor.json \
  department.json section.json person.json job_assignment.json ticket.json
```
