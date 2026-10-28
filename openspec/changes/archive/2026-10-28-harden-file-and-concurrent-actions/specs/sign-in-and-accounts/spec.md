## ADDED Requirements

### Requirement: Rotating IPv6 addresses does not reset sign-in limits

Sign-in attempt limits SHALL treat IPv6 addresses in the same /64 network as one source. Sign-in history SHALL still record the full address used.

#### Scenario: Rotate within one network

- **WHEN** the user exhausts sign-in attempts and changes to another IPv6 address in the same /64 network
- **THEN** further attempts are refused until the budget resets

#### Scenario: Another network has its own budget

- **WHEN** the user signs in from a different IPv6 /64 network
- **THEN** it has a separate attempt budget and history records the full sign-in address
