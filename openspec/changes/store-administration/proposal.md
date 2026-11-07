# Proposal

## Why

Store Managers need to keep their own store's org chart right (floors,
departments, sections, which subcategories a section sells, who works where)
without asking a platform administrator, and without becoming one. A Cluster
Manager needs the same over the stores of their cluster, and the people above
them over more. Today only a System Manager can change these rows, so every
correction waits on one person (#462, #683 piece B, #919).

## What Changes

- **A job gives reach over stores.** An app can say which jobs make their
  holder an administrator of which stores. In Dash a Store Manager reaches
  their store, a Cluster Manager every store of their cluster (store, then its
  site, then the site's cluster), and a Chief Operating Officer or Director
  every store. Reach is worked out fresh on every request from the current job
  assignments, so a transfer or an ended assignment takes effect at once.
- **A grant can be limited to the holder's reach.** A permission can say
  "rows within the holder's reach" beside "all rows" and "rows the person
  created". Such a grant reaches only rows of the stores the holder administers,
  for reading, creating, changing and deleting alike, and a row can never be
  moved out of reach.
- **A store administrator can hand a narrower role to their own staff.** The
  app declares which roles each administrator may give. The giver chooses
  stores within their reach, and the person must currently work in each of
  them. Nobody gives a role to themselves, nobody gives a role the app did not
  allow, and nobody gives one wider than their own reach. The role stops
  reaching a store the moment its holder no longer works there, and the giver
  or the store's next administrator can take it back.
- **Appointments above the store stay with HR.** Through their reach a store
  administrator cannot create, change or remove a Store Manager, Cluster
  Manager, COO or Director assignment, so no one can widen their own or anyone
  else's reach by appointing.
- **Employees and their stints**: HR (a new Dash HR role) and System Managers
  edit them; store administrators read the employees who work in their stores.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `app-roles-store-access`: reach from jobs, grants limited to reach, and
  bounded delegation.
- `feather-dash-people`: which Dash jobs administer which stores; who reads and
  edits employees and stints.

## Impact

- Platform: a third Permission row scope, a Role Assignment Table for given
  roles, the manifest's `administration` declaration and its enforcement on
  list, read, create, update and delete. Other paths (import, bulk edit,
  connections, comments) refuse a holder whose only grant is limited to reach.
- Dash 0.12.0: three new roles and grants on existing Tables, and an instance
  setup step that marks Plant and Site Master as deciding scope. An app upgrade
  refuses new grants on existing Tables, so this version installs fresh, or
  needs the owner's decision on the upgrade rule (design.md, open question 2).

Not in this change: checking a Cluster Manager's cluster and a stint's legal
company against the organisation masters (#919 item 4). An app's save checks
read only the app's own Tables, so it needs its own platform change.
