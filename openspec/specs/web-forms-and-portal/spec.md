# Web Forms and Portal

## Purpose

A published web form lets anyone fill in and submit data without signing in or
having an account. The portal is where a signed-in outside user, such as a
customer, comes back to see and open the rows that belong to them.

## Requirements

### Requirement: Fill in a published form

Anyone SHALL be able to open a published form's own link and submit it without
signing in. The fields shown are the ones the form's builder chose, each
marked when it's required, and submitting creates the row it's for.

#### Scenario: Submit without an account

- **WHEN** a visitor opens a published form, fills in its fields, and submits
- **THEN** the row is created and the visitor sees the form's confirmation
  message

### Requirement: A missing or unpublished form is not reachable

Opening a form that doesn't exist, or one its builder hasn't published yet,
SHALL fail rather than show a blank or half-built form.

#### Scenario: A draft form isn't public

- **WHEN** a visitor opens the link to a form still being drafted
- **THEN** they're told there's no form there

### Requirement: A bad answer is called out without losing the rest

Submitting a form with a missing required answer, or an answer that isn't
valid for its field, SHALL be refused with an explanation, leaving the
visitor's other answers as they typed them.

#### Scenario: Missing a required field

- **WHEN** a visitor leaves a required field blank and submits
- **THEN** the submission is refused with an explanation, and nothing the
  visitor already filled in is lost

### Requirement: Repeated submissions from the same visitor are refused

Submitting a published form too many times in a short span SHALL be refused,
with a message telling the visitor to try again later.

#### Scenario: Too many submissions too quickly

- **WHEN** a visitor submits the same published form far more often than a
  real visitor would in a short span
- **THEN** the form refuses the extra submissions and tells them to try again
  later

### Requirement: A signed-in submitter owns what they submit

If the visitor is signed in when they submit a form, the row it creates SHALL
belong to them, so it's the one they see when they come back to their portal.
Submitting while signed out never attaches the row to anyone's portal.

#### Scenario: A customer's request lands in their portal

- **WHEN** a signed-in customer submits a public form meant for support
  requests
- **THEN** the request they created appears in their own portal afterwards

### Requirement: The portal shows only what belongs to the user

The portal's own list, row pages and attachments SHALL show only the rows and
files that belong to the signed-in user: its list names only their rows, and
opening a row or attachment that belongs to someone else SHALL be refused.

#### Scenario: Two customers, two portals

- **WHEN** two customers each have their own request and one of them opens
  their portal
- **THEN** they see only their own request, not the other customer's

#### Scenario: Opening someone else's row directly

- **WHEN** a customer opens the direct link to another customer's row
- **THEN** they're told they don't have access to it
