## ADDED Requirements

### Requirement: The scope provider's Tables exist

Instance health SHALL check, for the one enabled app that provides people's
scope, that every Table it reads for scope and every column it declares reading
from them exists on the instance. While any is missing the check SHALL fail as
an operational fault naming each missing Table and column, and nothing else.

#### Scenario: An instance lacks a Table the scope provider reads

```gherkin
Given the user has an instance whose scope provider reads a Table the instance does not have
When the user checks its health
Then the missing Table is named as an operational fault, with the warning that no one gets a scope until it exists
And once the Table and its declared columns exist, the check passes
```
