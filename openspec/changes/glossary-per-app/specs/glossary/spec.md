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

### Requirement: A repeated word shows where each meaning comes from

When an app and the instance both have a term with the same name, an app's glossary SHALL show both, each under where it comes from: the app, or the instance's own terms shared by every app.

#### Scenario: One word, two sources

```gherkin
Given a shelf-planning app defines "Shelf Lead"
And the instance has its own term "Shelf Lead"
When the user opens the shelf-planning glossary
Then "Shelf Lead" is listed twice
And one is marked as coming from the shelf-planning app and the other as shared across apps
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
