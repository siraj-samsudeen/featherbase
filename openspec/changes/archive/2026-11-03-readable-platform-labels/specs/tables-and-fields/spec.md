# Tables and Fields

## ADDED Requirements

### Requirement: Readable labels without replacing authored wording

The platform SHALL supply readable labels when none are authored, retaining
common acronyms. Upgrading built-in labels SHALL preserve custom wording,
overrides and effective translations.
Fresh and existing instances SHALL converge through an ordered, repeatable
update limited to enumerated exact old defaults on noncustom platform columns.
A legacy base label needed by an installed translation SHALL be retained.

#### Scenario: Generated labels leave authored wording intact

```gherkin
Given the user defines a contact list with an unlabelled client identifier and an authored service label
When the user opens the contact list
Then the generated identifier label is readable with its acronym preserved
And the authored service label is unchanged
```

#### Scenario: Upgrade preserves customized wording

```gherkin
Given the user has customized and translated labels beside unchanged platform defaults
When the platform label update is applied
Then eligible unchanged platform defaults become readable without displacing installed translations
And the user's custom wording and effective translations remain unchanged
```

### Requirement: Authored choice wording does not change saved values

Forms, lists, filters and public forms SHALL show an existing original-value
translation first, otherwise translated authored wording, otherwise the value
verbatim. Translations SHALL NOT be recased. Display wording SHALL NOT change
allowed or saved values, filters, exports, row requests/responses or definition
editors, and SHALL NOT become an additional valid value.

#### Scenario: Readable policy choice keeps its original value

```gherkin
Given the user has a contact list with authored wording for a technical policy choice
When the user chooses that policy and saves a contact
Then the contact shows the authored policy wording in its form, list and filter control
And filtering by that policy finds the contact using its original value
```

#### Scenario: Unmapped choices keep their authored text

```gherkin
Given the user has a contact list with an unmapped choice containing underscores and no translation
When the user opens that choice in a contact
Then the choice text is shown verbatim
```

#### Scenario: Installed choice translations keep their wording

```gherkin
Given the user's contact policy has different translations for its original value and its authored wording
When the user opens that policy in a contact
Then the existing translation of the original value is shown unchanged
```
