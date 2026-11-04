# Design: ticket type transitions

```mermaid
flowchart LR
  admin[System Manager] -- edits --> type[Ticket type row: states, done states, routing, transitions]
  person[Raiser / assignee / role holder] -- takes an action --> action[Tickets 'transition' action]
  action -- reads --> type
  action -- caller's roles --> platform[Featherbase runtime context]
  action -- writes --> ticket[Ticket state] & history[Private history + public progress]
```

## Decisions

### 1. Transitions are a JSON list on the ticket type row

The type row gains one `transitions` column holding a list of `{state, action, next_state, allowed, fields}`. Its
keys are the platform Workflow transition's, plus `fields`. Routing already lives on the same row as JSON, so one
type is still one row, and the upgrade is one added column.

Rejected: a child Table of transition rows, like the platform Workflow. It gives each row a form, but costs a new
Table, its permissions and its own validation across rows, for a list a System Manager writes once per type.

`condition` (the platform Workflow's row expression) is refused for now rather than silently ignored.

### 2. A role is a platform role, told to the app by the runtime

`allowed` names `assignee`, `requester`, `any`, or otherwise a role. The runtime tells an action and a read the
caller's own roles; it never says anything about another person.

Rejected: a Tickets setting listing the people in each named group (as `support_users` does). It works without a
platform change, but it is a second place to grant a role, which drifts from the first.

### 3. `any` means anyone involved in the ticket

`any` is the raiser, the assignee or a Tickets support user. A colleague who can see a ticket's summary is not
involved: shared visibility never grants a change (stage one's rule).

### 4. Action fields are type fields

A transition names type fields. Those fields are asked at that action and left off the new-ticket form; at the
action they are required whatever their own required flag says. Their values are kept with the request's details
(the latest value shows on the ticket) and every value is kept in history. They follow the ticket's visibility (decision 6).

Rejected: values only in history. The page would have to replay history to show the current fix plan.

### 5. Types without transitions are untouched

Only a type with at least one transition changes behaviour, so existing types and their tickets keep working.

### 6. Who reads a ticket's details is a choice per type; open is the default

Tickets began as an access-request app: "Shared progress. Private details." On 04-Nov-2026 Siraj ruled that
privacy is a choice per ticket type, and open is the default (option A). A type's `details_visible_to` is
`everyone` (the default, and any type without the setting) or `private`. Built-in types, access requests among
them, stay private.

An open type's request and history live in their own Tables that everyone may read, so the platform's own
permissions give exactly the promised audience, through the app and the generic API alike. A private type's
stay in the private Tables, read by the requester and support only. A ticket's details never move between the
two: changing a ticket to a type with the other visibility is refused.

Rejected: one set of Tables with the app deciding who reads them. The platform enforces reads on its own Tables,
so private rows readable by everyone through the generic API would leak.

Not done: letting the assignee and the "raised for" person of a **private** type read its details. The platform
can only grant a private row to its creator or to a role (or by a share, which lists do not honour). It needs a
row-readers rule in the access policy, or an upgrade that widens a grant (piece E of #683): #925.
