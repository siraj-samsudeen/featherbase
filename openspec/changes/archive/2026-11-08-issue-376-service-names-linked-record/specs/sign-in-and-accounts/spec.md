## ADDED Requirements

### Requirement: A connected service must name the linked record

When an administrator has set where a connected service's answer names the person's record, a sign-in through that service SHALL be refused, as for a wrong password, unless the answer names the record the account is linked to. The activity log names the link, and an answer about somebody else never disables this person.

#### Scenario: The HR system answers for someone else

- **WHEN** a Team Leader's account is linked to HR record 7001, and the HR system confirms their password but names record 7002
- **THEN** they are refused as for a wrong password, and the activity log names their link

#### Scenario: The HR system names the linked record

- **WHEN** the HR system confirms the password and names record 7001
- **THEN** the Team Leader is signed in
