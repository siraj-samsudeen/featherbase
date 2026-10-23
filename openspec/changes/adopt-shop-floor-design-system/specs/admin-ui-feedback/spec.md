# Admin UI Feedback Delta

## RENAMED Requirements

- FROM: `### Requirement: Theme and colour palette follow the user, not the device`
- TO: `### Requirement: Theme follows the user, not the device`

## MODIFIED Requirements

### Requirement: Theme follows the user, not the device

Choosing light, dark or follow-the-device SHALL apply right away and save it to the user's own account, so it is there
again the next time they sign in on any device, without ever showing another account's choice on a shared browser.
Before anyone signs in, pages follow the device's own light or dark setting. There is one colour palette.

#### Scenario: Two choices, two accounts

- **WHEN** a user picks dark mode and then reloads the page
- **THEN** dark mode is still active, and signing in as a different user shows that user's own choice instead

#### Scenario: Follow the phone before signing in

- **WHEN** someone whose phone is set to dark opens the sign-in page
- **THEN** the sign-in page is dark
