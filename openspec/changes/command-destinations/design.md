## Decisions

### Use existing authoritative catalogues, not a second command list

Extend shared page classification without changing which pages recents remember. Resolve dynamic destinations on the server using Table metadata, existing permission/scoping functions, visible Home Pages and the available app catalogue. The client matches readable labels and activates existing routes. Reject hand-maintained page commands and a metadata read capped at 200: both silently omit destinations.

Table identities remain exact metadata names; typed router parameters own navigation. Do not import #821's unmerged route conversion or case-convert resource IDs. A singleton opens its existing form, never a new-row action.

### Inventory destinations, not every possible URL

Static Admin pages, own account sign-in methods, capability-gated interim report, visible Home Pages, readable saved dashboards/registered script reports, manager Data Source browsers, published readable Web Forms, available app roots/tabs and all readable non-child Tables are independently openable. Parameterized row/print/map URLs, Table-specific editing tools and alternative Table views require context and are not separate inventory entries. Portal lists are an alternate Table rendering, not a second destination. Authentication/callback/reset flows and redirect/layout roots are entry flows, not navigation destinations. The executable route guard lists each source or exclusion explicitly; a new route must make that choice.

Apply app availability even for privileged viewers; permission bypass does not make an unavailable app openable. Preserve Admin/app-only boundaries. Read scoped named resources through existing read contracts, never raw unfiltered labels.

### Treat dismissal as visibility, not clearing

Keep destination activation's existing clearing behavior. Outside pointer and Escape instead close visibility and reset selection while retaining the query; Escape is handled at the form boundary so focused results work. A document pointer listener checks containment before dismissal. Results render only while open, so a late response cannot reopen them. Focus/Cmd K reopens and Tab inside remains usable.

### Keep the existing visual language

Use the real command bar, current result rows, grouped headings and kind captions. Add a bounded scroll surface for complete inventories rather than dropping matches after seven. No sidebar or app shell redesign.
