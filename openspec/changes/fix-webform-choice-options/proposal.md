# Proposal

## Why

Published forms currently show an empty picker for every choice field, so a visitor cannot submit a required choice at all. Visitors need the form to offer the same ordered choices its builder defined.

## What Changes

- Include each choice field's declared options in the public form configuration.
- Render those options in their declared order and submit the visitor's selected value through the existing validated save path.
- Cover the public configuration, rendered form, persisted selection, and rejection of an invalid choice with focused tests.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-forms-and-portal`: A published form offers the configured options for a choice field so a visitor can select and submit one.

## Impact

The shared public-form contract, server WebForm configuration, public React form renderer, and focused server/browser tests are affected. The metadata engine and general form behavior are unchanged.
