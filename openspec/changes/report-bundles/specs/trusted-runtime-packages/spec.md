# Trusted Runtime Packages

## ADDED Requirements

### Requirement: An app can add its own check to who opens it
An app MAY name one of its reads as its gate. The app SHALL open for a person only when they could open it already and that read, run for them, answers exactly true; any other answer or a failure SHALL keep it closed. An app MAY also name its own roles as approvers of access: they SHALL be mailed with System Managers when someone is waiting for the app, the mail SHALL link to the page the app names, and the app SHALL be able to list who is waiting only for a System Manager or an approver.

#### Scenario: A gate that fails keeps the app closed

- **WHEN** an app's gate read throws for a person who holds the app's role
- **THEN** the app is not offered to them and opening it is refused with the no-access page

#### Scenario: An approver hears about a request

- **WHEN** someone without access opens an app whose approvers include a role Meera holds
- **THEN** Meera is mailed with a link to the app's access page, and she sees that person waiting there
