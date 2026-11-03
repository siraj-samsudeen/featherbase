# Captured Email Reading

## Purpose

Locally captured email can be read as a message without confusing capture with
external delivery or treating message content as executable markup.

## Requirements

### Requirement: Read a locally captured email

The user SHALL be able to read a locally captured email with its subject, sender, recipient, recorded time, message and attachment names, with raw values secondary. Local capture SHALL be distinguished from external delivery.

#### Scenario: Read a captured invoice notice

```gherkin
Given the user can read the locally captured invoice notice
When the user opens the captured invoice notice
Then the user reads the invoice notice as an email with its attachment names
And the user is told that local capture does not confirm external delivery
And raw values are initially collapsed and cannot be edited
```

#### Scenario: Read an empty captured invoice notice

```gherkin
Given the user can read the locally captured invoice notice without a message or attachments
When the user opens the captured invoice notice
Then the user sees that there is no message body and no attachments
```

### Requirement: Treat captured content as text

Captured content SHALL be displayed as inert text, preserving line breaks and wrapping long lines, without executing content or loading remote resources.

#### Scenario: Read an invoice notice containing markup

```gherkin
Given the user can read the locally captured invoice notice containing unsafe markup and a long line
When the user opens the captured invoice notice
Then the markup remains visible text without executable content or remote requests
And the message preserves line breaks and fits its reading area
```
