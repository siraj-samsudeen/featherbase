# Master data sync

## Purpose

Featherbase keeps a master Table, such as People or stores, in step with a table copied in from the system it
comes from. What the source owns follows the source; every other difference is raised to the people who own it.

## Requirements

### Requirement: The source's changes reach what the source owns
A copied table MAY be kept in step with a master Table. On each refresh, a value the source owns that changed at
the source, and was not changed in Featherbase, SHALL be applied to the master row it is linked to, and its
history SHALL say which source it came from.

#### Scenario: A name changed in StyleHR reaches the Person row

```gherkin
Given StyleHR's staff are copied in and kept in step with People, Asha linked to her StyleHR row
When StyleHR changes Asha's name to "Asha R" and the copy is refreshed
Then Asha's Person row reads "Asha R", and its history says the change came from StyleHR
```

### Requirement: Every other difference is raised once
A difference the sync does not apply SHALL be raised as a ticket to the source system's contact: an edit in
Featherbase to a value the source owns, a source change to a value Featherbase owns, or both changing. A later
refresh SHALL NOT raise the same difference again.

#### Scenario: A phone edited in Featherbase asks whether StyleHR should be fixed

```gherkin
Given StyleHR's staff are copied in and kept in step with People, Asha linked to her StyleHR row
When a person changes Asha's phone in Featherbase and the copy is refreshed twice
Then Asha's phone is kept, and one ticket asks whether StyleHR should be fixed
```

### Requirement: Rows are never linked or deleted automatically
A new source row with no link SHALL raise a ticket to create or link it. A row gone from the source SHALL mark the
master row inactive when the sync says how, and raise a ticket otherwise; nothing SHALL be deleted.

#### Scenario: A new StyleHR row is raised, not linked

```gherkin
Given StyleHR's staff are copied in and kept in step with People, Asha linked to her StyleHR row
When StyleHR adds Devan and the copy is refreshed
Then a ticket asks to create or link Devan, and no Person row is linked to him
```

#### Scenario: A row gone from StyleHR marks the person inactive

```gherkin
Given StyleHR's staff are copied in and kept in step with People, Asha linked to her StyleHR row
When StyleHR removes Asha and the copy is refreshed
Then Asha's Person row is marked inactive and is still there
```

### Requirement: A rule keeps working when what it names is renamed

Renaming the master Table, the Source Link Table, or a column a sync rule names on the master, the link or the copied
table SHALL carry the new name into the rule. The next sync SHALL run as before, and SHALL NOT raise again a
difference that was already raised.

#### Scenario: People renamed to Members

- **WHEN** a System Manager renames People to Members and its phone column to mobile, with a phone difference already
  raised
- **THEN** the next refresh syncs Members, applies StyleHR's changes, and raises nothing new
