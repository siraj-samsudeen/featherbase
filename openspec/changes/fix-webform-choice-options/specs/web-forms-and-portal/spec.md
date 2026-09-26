# Web Forms and Portal Delta

## MODIFIED Requirements

### Requirement: Fill in a published form

Anyone SHALL be able to open a published form's own link and submit it without
signing in. The fields shown are the ones the form's builder chose, choice
fields offer their configured answers in the configured order, and each field
is marked when it's required; submitting creates the row it's for.

#### Scenario: Submit without an account

- **WHEN** a user opens a published form, fills in its fields, and submits
- **THEN** the row is created and the user sees the form's confirmation
  message

#### Scenario: Choose a configured answer

- **WHEN** a user opens a published form with a required choice field whose
  configured answers are "Standard", "Expedited", and "Same day"
- **THEN** those answers are offered in that order, and selecting "Expedited"
  lets the user submit it as the field's answer
