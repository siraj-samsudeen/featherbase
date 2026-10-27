## ADDED Requirements

### Requirement: A preview deploy ends with its preview person, or fails

A deploy's pre-deploy step SHALL run the release and then the preview seed as one command, and SHALL fail the deploy when either fails. Where preview sign-in is configured, a deploy that succeeds SHALL leave the person the preview link names in place; where it is not configured, the seed SHALL create nothing.

#### Scenario: A preview deploy

- **WHEN** an operator deploys with the preview sign-in key and person set
- **THEN** the release runs, then the preview person and the demo Table are created, and the preview link signs in as that person

#### Scenario: The preview seed fails

- **WHEN** the release succeeds but the preview person cannot be created
- **THEN** the deploy fails, and the old version keeps serving

#### Scenario: Not a preview

- **WHEN** an operator deploys without the preview variables
- **THEN** the release runs and no preview person is created
