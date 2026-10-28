# Personal Preferences Delta

## MODIFIED Requirements

### Requirement: Choose a language

A user's language SHALL be a choice stored on their own account, and the Admin's own text — labels, buttons,
messages — SHALL appear in it on every later sign-in, on any device. No translation ships yet, so the Admin SHALL show
no language picker; the stored choice and the translation catalog keep working, so a picker can return when a
translation does (Siraj, 24-Oct-2026).

#### Scenario: Switch language

- **WHEN** the user's stored language changes to French
- **THEN** the Admin's own text appears in French right away

#### Scenario: No picker while no translation ships

- **WHEN** the user opens the Admin, on a phone or a computer
- **THEN** the header and the account menu show no language picker, and the Admin's text is in English

#### Scenario: A language follows the user

- **WHEN** a user whose stored language is French signs in on a different computer
- **THEN** the Admin is in French there too, with no need to choose it again
