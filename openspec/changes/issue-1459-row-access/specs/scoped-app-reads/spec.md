# Scoped App Reads

## MODIFIED Requirements

### Requirement: A Table about places is read within each person's places
A table whose row rule is the person's places, said by its app or by a System Manager, SHALL be read only within each person's places, wherever rows are listed, counted, opened or changed. A row the person wrote SHALL always be theirs. A System Manager SHALL NOT be narrowed.

#### Scenario: A section's answers, and no other

```gherkin
Given a review Table holds an answer at store "9001" for subcategory "000000001" and one for subcategory "000000004"
And the reader's only place is store "9001" with subcategory "000000001"
When the reader lists the review Table
Then it answers the first answer only
And opening the second answer is refused
```

#### Scenario: A place the Table cannot apply adds nothing

```gherkin
Given a reader's place names a filter the Table does not map
When the reader lists the Table
Then that place adds no rows
```

#### Scenario: Someone with no places sees only what they wrote

```gherkin
Given the org chart gives the reader no place
When the reader saves an answer and lists the review Table
Then the list holds that answer only
```

#### Scenario: A row outside one's places is not changed

```gherkin
Given the reader's only place is store "9001"
When the reader changes an answer at store "9002"
Then the change is refused
```
