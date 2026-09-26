# Personal Preferences

## Purpose

A user's language follows them, not the device they're on, so switching
computers never means switching languages. Theme and colour palette are
covered in admin-ui-feedback and not repeated here.

## Requirements

### Requirement: Choose a language

The user SHALL be able to pick a language from a short list, and the Admin's
own text — labels, buttons, messages — SHALL switch to it immediately and
again on every later sign-in, on any device.

#### Scenario: Switch language

- **WHEN** the user picks French
- **THEN** the Admin's own text appears in French right away

#### Scenario: A language follows the user

- **WHEN** a user who chose French signs in on a different computer
- **THEN** the Admin is in French there too, with no need to choose it again

### Requirement: An untranslated word falls back to the original

If a piece of text has no translation yet in the user's chosen language, the
user SHALL see it in its original language rather than a blank or an error.

#### Scenario: Missing translation

- **WHEN** the interface shows a word that has never been translated into the
  user's language
- **THEN** the word appears in its original language, not blank
