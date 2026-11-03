# Tasker Discussions

## Purpose

Keep each task's updates, questions and replies together so people can see what needs their attention and what has been settled.

## Requirements

### Requirement: Replies stay with their conversation

The user SHALL post an update or a question under a task or subtask and reply directly to it. Replies SHALL stay grouped beneath that original message, with author and time, without deeper nesting.

#### Scenario: Two questions on one task

- **WHEN** the user replies to the first of two questions
- **THEN** the reply is shown under that question, not mixed into the second conversation

### Requirement: Questions say who needs to reply

The asker SHALL choose one team member or anyone to respond to a shared question. Tasker SHALL distinguish questions waiting for a reply, replies awaiting the asker's review, and resolved questions; ordinary updates need no resolution.

#### Scenario: Receive an answer

- **WHEN** a teammate replies to the user's question
- **THEN** the conversation needs the user's review and is not automatically resolved

### Requirement: The asker resolves questions

Only the asker SHALL mark a question resolved or reopen it. Reading a conversation SHALL NOT resolve it, and resolving it SHALL NOT complete the task.

#### Scenario: Resolve and reopen

- **WHEN** the user accepts a reply to their question and later reopens that question
- **THEN** it first appears as resolved and then returns to waiting for a reply

### Requirement: Attention shows the next action

Questions directed to the user and replies awaiting their review SHALL rise to their attention list, with unread activity clearly identified. Questions directed to anyone SHALL remain discoverable as open team questions.

#### Scenario: Find the response needed

- **WHEN** the user has an unread question directed to them, an answer to review and a resolved question
- **THEN** the first two appear as needing attention with their different next actions
- **AND** the resolved conversation remains available without being presented as unanswered

### Requirement: Discussion follows task privacy

Task and subtask discussion SHALL be visible only to people who can access that work, including its attention indicators and unread counts.

#### Scenario: A private question

- **WHEN** an administrator who is not the creator opens their attention list or requests a private task's conversation
- **THEN** the private question is neither disclosed nor counted for them

### Requirement: Private questions do not imply team visibility

A private task's question composer SHALL explain that only its creator can see the question until sharing. It SHALL NOT offer other members as respondents, and direct requests naming another respondent SHALL be refused until the task is shared.

#### Scenario: Ask a question while planning privately

- **WHEN** the creator writes a question on their private task
- **THEN** the respondent control shows that only the creator can see it until sharing
- **AND** no teammate can be selected
