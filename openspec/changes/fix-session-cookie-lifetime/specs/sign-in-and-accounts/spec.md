# Sign In and Accounts Delta

## MODIFIED Requirements

### Requirement: Stay signed in

Once signed in by any supported method, a user SHALL stay signed in across visits and browser-based features for as long as the session length an administrator has set, without re-entering credentials each time.

#### Scenario: Return within the session length

- **WHEN** a signed-in user closes and reopens the browser before their session length has passed
- **THEN** they are still signed in

#### Scenario: Browser features use the full session length

- **WHEN** an administrator chooses a session length shorter or longer than seven days and the user signs in with a password, Google, or a preview link
- **THEN** private files and live updates remain available until that configured session length ends
