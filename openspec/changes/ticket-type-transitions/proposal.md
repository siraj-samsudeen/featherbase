# Ticket type transitions

Issue: [#918](https://github.com/siraj-samsudeen/featherbase/issues/918). Design approved by Siraj on 04-Nov-2026.

## Why

A configured ticket type today lets support move a ticket to any of its states. For a Data Quality Issue the
order and the people matter: the person who owns the source confirms a fix plan with a target date, the raiser
verifies the fix. Without that, a ticket can be closed by the wrong person, or without the plan written down.

## What Changes

- A ticket type may list its **transitions**: from which state an action moves a ticket to which state, who may
  take it (the assignee, the raiser, anyone involved, or a role), and which of the type's fields must be filled
  when they do. The shape is the platform Workflow's (state, action, next state, allowed).
- When a type has transitions, those are the only moves: the server refuses any other state change, including a
  direct change, resolve and reopen. A type without transitions works as today.
- The ticket page shows the actions the viewer may take now and asks for each action's fields. Fields that an
  action asks for are not asked on the new-ticket form.
- History records who took which action, from which state to which, and what they wrote. Public progress shows
  the action, not the private values.
- A ticket type says who reads its details and history: everyone who can see the ticket (the default) or, when it
  is private, the raiser and support only (Siraj, 04-Nov-2026). Built-in types such as access requests stay
  private.
- An app action learns the caller's own roles, so a transition can be allowed to a role.

## Capabilities

### New Capabilities

- `tickets-type-transitions`: a ticket type's own actions, who may take them and what they must record.

### Modified Capabilities

- `trusted-runtime-packages`: an app's action and read know which roles the caller holds.
