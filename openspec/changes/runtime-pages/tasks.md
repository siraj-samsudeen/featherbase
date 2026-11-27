## 1. The checker and the catalog (shared)

- [x] 1.1 Unit tests, red: a definition's shape; an unknown part; an unknown or misspelled setting; a wrong value; a child that does not exist; no root, or a root that is not a Page; a cycle; an unknown function or action; a path to state or data that is not declared; every mistake reported at once, keyed by where it is
- [x] 1.2 The page definition, the ten parts, the named functions and the named actions, with the checker that reports every mistake
- [x] 1.3 The catalog as an agent reads it: each part and its settings, the functions, the actions, and the worked example, which the checker itself accepts
- [x] 1.4 Which columns of each data source a page reads, so the server can check them against the Table

## 2. Scenario tests, red

- [x] 2.1 Server scenarios of runtime-pages: who may save, the two refusals, the two agent scenarios
- [x] 2.2 Screen scenarios of runtime-pages: the saved page opens; rows as the viewer; the page without its rows; the choice; the groups; the three saves; sample rows; the draft and the missing page; the group's two lists

## 3. Server

- [x] 3.1 The `Page` platform Table: migration, and the migration added to every pinned list of migrations in the tests
- [x] 3.2 The save check: the definition is checked in the Table's validate hook; each data source's Table and columns are checked against Table metadata; the name is an address
- [x] 3.3 Reading: the pages a person may open, and one page; a Draft answers as not there to someone who may not build
- [x] 3.4 A module's Home Page answer lists its pages
- [x] 3.5 MCP: `list_parts`, `list_pages`, `get_page`, `save_page`; `create_table` takes `module`

## 4. Web

- [x] 4.1 Unit tests, red: reading a path from the top and from a row; a repeated child; each named function; writing a value back; an action's context
- [x] 4.2 The runtime: state kept in the address, data sources read through the list API, the page's own copy of rows, the actions
- [x] 4.3 A table with column bands and groups that open, as a shared component with its story, in the list view's look
- [x] 4.4 The ten parts over the shared components; every record a RecordLink
- [x] 4.5 The page's route inside the shell; loading, refused and not-there states; the sample-data line
- [x] 4.6 A Home Page's "Pages" card

## 5. Words

- [x] 5.1 `CONTEXT.md`: the word Page, and the words it retires

## 6. Checks

- [ ] 6.1 Both typechecks; the shared, server and web suites with coverage; `pnpm check:scenarios`, `pnpm check:specs`, `pnpm check:vocabulary`, `pnpm check:sensitive`, `pnpm check:platform-imports`
- [x] 6.2 Through the running server: an agent's tool calls make a Table, load rows, save the worked example's page and read it back
- [ ] 6.3 Independent verifier at 1280 px against #1410's points 10 to 26 and the worked example's mock-up
- [x] 6.4 `openspec validate runtime-pages --type change --strict`
