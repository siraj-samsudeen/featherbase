# Personal Preferences

## Purpose

A user's language follows them, not the device they're on, so switching
computers never means switching languages. The theme is covered in
admin-ui-feedback and not repeated here.

## Requirements

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

### Requirement: An untranslated word falls back to the original

If a piece of text has no translation yet in the user's chosen language, the
user SHALL see it in its original language rather than a blank or an error.

#### Scenario: Missing translation

- **WHEN** the interface shows a word that has never been translated into the
  user's language
- **THEN** the word appears in its original language, not blank
