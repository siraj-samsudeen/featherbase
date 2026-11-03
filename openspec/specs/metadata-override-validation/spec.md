# Metadata Override validation

## Purpose

Help users apply Table and column customizations that take effect, with clear refusals when a target or setting is invalid.

## Requirements

### Requirement: Target an existing column

A Metadata Override is a customization of a Table or one of its columns. On creation and editing, the system MUST match the internal column name on the selected Table, including Custom Fields (columns added by the user), and refuse a missing column with its name identified. Customizations of the whole Table MUST remain available without choosing a column.

#### Scenario: A column label is not its name

```gherkin
Given the user can customize a catalogue with a category column
When the user saves a customization using the category label instead of its name
Then the customization is refused with the missing column identified
```

#### Scenario: A whole catalogue can still be renamed

```gherkin
Given the user can customize a catalogue with a category column
When the user customizes the whole catalogue label without choosing a column
Then the catalogue has the customized label
```

#### Scenario: A column from another catalogue is refused

```gherkin
Given the user can customize a catalogue with a category column
And another catalogue has a supplier column
When the user saves a supplier customization on the category catalogue
Then the customization is refused with the missing column identified
```

#### Scenario: A user-added category can be customized

```gherkin
Given the user can customize a catalogue with a category column
And the user has added a priority column to that catalogue
When the user customizes the priority label
Then the user-added column has the customized label
```

#### Scenario: An invalid target edit keeps the saved customization

```gherkin
Given the user can customize a catalogue with a category column
And a category label customization is saved
When the user edits that customization to use a missing column
Then the customization is refused with the missing column identified
And the saved category customization is unchanged
```

### Requirement: Use an explicit boolean setting

For permitted boolean settings (hidden, required, read-only, and list visibility), the system MUST accept text `true` and `1` as yes, and `false` and `0` as no. It MUST refuse any other, empty, or missing value on creation and editing rather than silently treating it as no.

#### Scenario Outline: An invalid boolean is refused

```gherkin
Given the user can customize a catalogue with a category column
When the user saves a visibility customization with <input>
Then the customization is refused with the permitted boolean values

Examples:
  | input               |
  | the text "truetrue" |
  | the text "yes"      |
  | the text "2"        |
  | empty text          |
  | no value            |
```

#### Scenario Outline: Both boolean choices take effect

```gherkin
Given the user can customize a catalogue with a category column
When the user saves the "<setting>" customization with text "<value>"
Then the "<setting>" customization takes effect as "<effect>"

Examples:
  | setting         | value | effect |
  | hidden          | true  | yes    |
  | hidden          | false | no     |
  | hidden          | 1     | yes    |
  | hidden          | 0     | no     |
  | required        | true  | yes    |
  | required        | false | no     |
  | required        | 1     | yes    |
  | required        | 0     | no     |
  | read-only       | true  | yes    |
  | read-only       | false | no     |
  | read-only       | 1     | yes    |
  | read-only       | 0     | no     |
  | list visibility | true  | yes    |
  | list visibility | false | no     |
  | list visibility | 1     | yes    |
  | list visibility | 0     | no     |
```

#### Scenario: An invalid boolean edit keeps the saved customization

```gherkin
Given the user can customize a catalogue with a category column
And a hidden category customization is saved
When the user edits that customization to the text "yes"
Then the customization is refused with the permitted boolean values
And the saved category customization is unchanged
```

### Requirement: Explain permitted properties

The system MUST refuse an unknown customization property with the permitted properties for the chosen Table-level or column-level target. The existing property sets MUST remain unchanged; uniqueness is not an overridable property.

#### Scenario Outline: An unknown property is actionable for its target

```gherkin
Given the user can customize a catalogue with a category column
When the user saves a "<target>" customization with an unknown property
Then the customization is refused with the permitted "<target>" properties

Examples:
  | target       |
  | whole Table  |
  | column       |
```

#### Scenario: Uniqueness remains prohibited

```gherkin
Given the user can customize a catalogue with a category column
When the user saves a category uniqueness customization with text "true"
Then the customization is refused with the permitted "column" properties
And uniqueness is absent from the permitted properties
```
