# Access Tokens

## ADDED Requirements

### Requirement: A service account has a display name

A System Manager SHALL be able to give a service account a display name, such as "Claude — setup
agent", which is what people read wherever the account did something. Without one, the account
SHALL read as "Automation (<its short name, without svc->)". The short name SHALL NOT change.
Only someone who may read the Service Account Table SHALL see the display name through the
general name lookup; anyone else SHALL read "Automation (<short name>)".

#### Scenario: An account reads as automation until it is named

- **WHEN** the service account "svc-installer" gives someone a role
- **THEN** that person reads "given by Automation (installer)"
- **AND** after a System Manager names the account "Claude — setup agent", it reads "given by Claude — setup agent"
