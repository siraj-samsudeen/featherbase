## MODIFIED Requirements

### Requirement: A System Manager can make their view everyone's default

A System Manager SHALL be able to make their whole view of a list the Table's default: its layout, columns, sort,
compact rows and the Links tab's choices. Before it is saved they SHALL see each setting named in words. A colleague's
own choices SHALL still apply on top; for a choice they have never made, the Table's default SHALL apply, and with no
default the platform's own. A save SHALL be kept with who made it and when, and SHALL be undoable while it is still
the Table's default (#1282 A4).

#### Scenario: My view becomes the default

- **GIVEN** a System Manager has switched on Remarks in the list of "Section Mapping"
- **AND** a colleague has never changed their own view of it
- **WHEN** the System Manager makes their view the default for everyone
- **THEN** the colleague's list shows Remarks

```gherkin
Given a System Manager has switched on Remarks in the list of "Section Mapping"
And a colleague has never changed their own view of it
When the System Manager makes their view the default for everyone
Then the colleague's list shows Remarks
```

#### Scenario: A colleague's own choices hold

- **GIVEN** a colleague has switched off Floor and switched on Notes in the list of "Section Mapping"
- **WHEN** a System Manager makes a default that includes Floor and leaves out Notes
- **THEN** the colleague's list still shows Notes
- **AND** the colleague's list still does not show Floor

```gherkin
Given a colleague has switched off Floor and switched on Notes in the list of "Section Mapping"
When a System Manager makes a default that includes Floor and leaves out Notes
Then the colleague's list still shows Notes
And the colleague's list still does not show Floor
```

#### Scenario: The default carries the layout, sort and compact rows

- **GIVEN** a System Manager has sorted the list of "Section Mapping" by Floor and switched on Compact Rows
- **AND** a colleague has never changed their own view of it
- **WHEN** the System Manager makes their view the default for everyone
- **THEN** the colleague's list is sorted by Floor with compact rows

```gherkin
Given a System Manager has sorted the list of "Section Mapping" by Floor and switched on Compact Rows
And a colleague has never changed their own view of it
When the System Manager makes their view the default for everyone
Then the colleague's list is sorted by Floor with compact rows
```

#### Scenario: Undo puts the previous default back

- **GIVEN** a System Manager has made their view the default for "Section Mapping"
- **WHEN** they undo it while it is still the Table's default
- **THEN** a colleague who never changed their view sees the previous default again

```gherkin
Given a System Manager has made their view the default for "Section Mapping"
When they undo it while it is still the Table's default
Then a colleague who never changed their view sees the previous default again
```

#### Scenario: Only a System Manager sets a default

- **WHEN** someone who is not a System Manager tries to make their view a Table's default
- **THEN** it is refused and the Table's default is as it was

```gherkin
When someone who is not a System Manager tries to make their view a Table's default
Then it is refused and the Table's default is as it was
```

## ADDED Requirements

### Requirement: A person can go back to the Table's default view

A person whose view of a list differs from the Table's default SHALL be able to reset it, which SHALL clear only
their own choices for that Table (#1282 A4).

#### Scenario: Reset to the Table's default

- **GIVEN** a Table has a default sorted by Floor and a colleague sorted it by Name
- **WHEN** the colleague resets to the Table's default
- **THEN** their list is sorted by Floor
- **AND** another colleague's own sort is unchanged

```gherkin
Given a Table has a default sorted by Floor and a colleague sorted it by Name
When the colleague resets to the Table's default
Then their list is sorted by Floor
And another colleague's own sort is unchanged
```

### Requirement: Showing retired rows and grouping are remembered

Showing retired rows and a board's grouping SHALL be remembered for that person on that Table. While retired rows
show, the list SHALL say so (#1282 A4).

#### Scenario: Retired rows still show next time

- **GIVEN** the user turned on Show Retired in the list of "Section Mapping"
- **WHEN** the user reopens that list
- **THEN** retired rows show and Show Retired reads as on

```gherkin
Given the user turned on Show Retired in the list of "Section Mapping"
When the user reopens that list
Then retired rows show and Show Retired reads as on
```
