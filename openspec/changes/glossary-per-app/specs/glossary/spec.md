# glossary

## RENAMED Requirements

- FROM: `### Requirement: Everyone can read the glossary`
- TO: `### Requirement: Each app has its own glossary`

## MODIFIED Requirements

### Requirement: Each app has its own glossary

Everyone who can use an app SHALL be able to read that app's glossary and search it: the app's own terms, then the instance's own terms. Nobody SHALL read the glossary of an app they cannot use. A search SHALL match a term's name, its words to avoid and its definition.

#### Scenario: An app's glossary holds its words and the company's

```gherkin
Given a shelf-planning app defines "Shelf Lead" and "Coverage"
And the instance has a term of its own, "Cluster"
When the user opens the shelf-planning glossary
Then it lists "Coverage" and "Shelf Lead", then "Cluster"
```

#### Scenario: A person who cannot use the app cannot read its glossary

```gherkin
Given a person who cannot use the shelf-planning app
When the person asks for the shelf-planning glossary
Then they are refused
```

#### Scenario: Searching by a word to avoid

- **WHEN** the user opens the shelf-planning glossary and searches for "scope", a word the "Coverage" term says to avoid
- **THEN** the "Coverage" term is found

### Requirement: Instances add and reword terms

People allowed to edit the glossary SHALL be able to add the instance's own terms and reword an app's terms. System Managers SHALL always be allowed, and an instance MAY allow other roles. Everyone else SHALL only read. An instance's own term shows in the glossary of every app, after that app's own terms.

#### Scenario: An instance's own term

- **WHEN** a System Manager adds a term that belongs to no app
- **THEN** it appears in the glossary of every app, after the app's own terms

#### Scenario: Reading only

- **WHEN** a person without permission to edit the glossary tries to change a term
- **THEN** the change is refused

## ADDED Requirements

### Requirement: One meaning per word

A glossary SHALL give each word one meaning. An instance term SHALL be refused when an app's term already has its name, and when another instance term has it; the refusal names the app, and the editor rewords the app's term in that app instead. A word that differs only in capitals or spaces counts as the same word. An app SHALL never be refused because of an instance term.

#### Scenario: The instance cannot take an app's word

```gherkin
Given a shelf-planning app defines "Shelf Lead"
When a System Manager adds an instance term "shelf lead"
Then it is refused, and the reason names the shelf-planning app
```

#### Scenario: Two instance terms cannot share a name

```gherkin
Given the instance has a term "Cluster"
When a System Manager adds another instance term "CLUSTER"
Then it is refused
```

#### Scenario: An app that arrives later keeps its own meaning

```gherkin
Given the instance has a term "Shelf Lead"
When a shelf-planning app that defines "Shelf Lead" is installed
Then the install goes through
And the shelf-planning glossary shows the app's "Shelf Lead" and not the instance's
```

### Requirement: Help opens the app's glossary

The Help menu of an app's sidebar SHALL open that app's glossary, for anyone who can use the app. The Admin has no glossary of its own, so its Help menu offers none.

#### Scenario: Help offers the app's glossary

```gherkin
Given the Tasker app is open for a person who can use it
When the person opens Help
Then Help offers Tasker's glossary
```

#### Scenario: The Admin's Help offers no glossary

```gherkin
Given a System Manager has the Admin open
When the manager opens Help
Then Help offers no glossary
```
