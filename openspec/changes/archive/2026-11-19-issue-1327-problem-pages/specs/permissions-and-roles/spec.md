## MODIFIED Requirements

### Requirement: The screen shows only what a person can use

After signing in, a person SHALL see only the tools they can use, decided by
the server from their current roles and grants.

#### Normative details for the whole requirement

Someone whose only access is
the Sales Target report SHALL get a bare screen — the report, their name,
their own sign-in methods and sign-out — with no administration menu, and
without the page asking for anything they would be refused. Someone with no
role of use at all SHALL get a plain page saying they have no access yet and
that an admin has been told, with sign-out; until they are given a role they
cannot manage their own sign-in methods. Building tables and importing data
SHALL be offered only to System Managers, as are changing a table's columns and
merging tables; the New button on a table's list is offered only where the
person may create rows. Access tokens stay available to everyone in the administration,
because they are self-service. A table list SHALL name only the tables the
person can read. A grant given to everyone (the built-in All role, which apps
use for their own tables) makes its table appear in lists but does not by itself
open the administration to someone. Someone with no grant of their own, only a row shared
with them, SHALL be told how such rows reach them rather than shown an empty
screen.

#### Scenario: A report-only person never meets the administration menu

```gherkin
Given the user holds only the Sales Target Viewer role
When the user opens an administration address
Then the user is told the administration is not part of their account, and offered the report
And no administration menu appears
And no administration request is made
```

#### Scenario: A person with no access is told so

```gherkin
Given the user holds no role of use
When the user signs in
Then the user sees that they have no access yet
And the user sees that an admin has been told
And the user sees a way to sign out
```

#### Scenario: A management address typed by someone else

```gherkin
Given the user is not a System Manager
When the user types the address for importing data
Then the user lands on the administration home
```
