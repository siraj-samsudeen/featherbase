# Feather Ask

## ADDED Requirements

### Requirement: Anyone signed in can ask

Once an instance installs Ask, everyone signed in SHALL be able to open it and ask, whatever their
roles. Someone signed out SHALL be sent to sign in.

#### Scenario: Ask opens for someone with no special role

- **GIVEN** the user is Selvi, signed in with no administrator role
- **WHEN** the user opens Ask
- **THEN** the user sees a few example questions and a place to ask

### Requirement: The answer shows under its question

The question SHALL show with its answer below it, the newest in view.

#### Scenario: The answer appears under the question

- **GIVEN** the user has typed "How many open tickets do I have?"
- **WHEN** the user asks
- **THEN** the question shows with its answer below it

### Requirement: An example question asks itself

Picking one of the example questions SHALL ask it, as if the user had typed it.

#### Scenario: Picking an example asks it

- **GIVEN** the user opens Ask with no chat open
- **WHEN** the user picks an example question
- **THEN** that question shows, followed by its answer

### Requirement: One question at a time

While an answer is on its way, the page SHALL show that it is being worked out and SHALL not send
another question.

#### Scenario: A second question waits for the first answer

- **GIVEN** the user has asked "How many open tickets do I have?" and its answer is on its way
- **WHEN** the user tries to ask "Which is the oldest?"
- **THEN** nothing more is sent until the first answer arrives

### Requirement: An empty question is not sent

A question with nothing in it SHALL not be sent.

#### Scenario: Nothing typed, nothing sent

- **GIVEN** the user has typed nothing
- **WHEN** the user tries to ask
- **THEN** nothing is sent

### Requirement: A question is at most 2000 characters

A question SHALL be at most 2000 characters long.

#### Scenario: A long question stops at 2000 characters

- **GIVEN** the user pastes a question of 2500 characters
- **WHEN** the user asks
- **THEN** only the first 2000 characters are asked

### Requirement: A failed question can be tried again

When a question cannot be answered because something went wrong, the page SHALL say so where the
answer would be and offer to try the same question again in the same place. A failed question
SHALL not be saved until it is answered.

#### Scenario: Trying again after a failure

- **GIVEN** the user's question failed because the connection dropped
- **WHEN** the user tries again
- **THEN** the same question is asked again and its answer replaces the failure

### Requirement: The first question starts a chat

Each answered question SHALL be saved with its answer in a chat: one conversation, the questions
asked one after another with their answers. The first question SHALL start a new chat, titled by
that question.

#### Scenario: The first question names the chat

- **GIVEN** the user starts a new chat
- **WHEN** the user asks "How many open tickets do I have?"
- **THEN** a chat titled "How many open tickets do I have?" holds the question and its answer

### Requirement: Each person sees only their own chats

A person SHALL see, open and add to only their own chats.

#### Scenario: Another person cannot see the chat

- **GIVEN** Selvi has a chat "How many open tickets do I have?"
- **WHEN** Ravi looks at his chats, or opens Selvi's chat directly
- **THEN** Selvi's chat is not there, and opening it finds nothing

### Requirement: The latest chats are always at hand

Beside every page of Ask, the user SHALL be able to start a new chat and see their latest chats,
newest first, each with how long ago it started, with a way to the full list. A new chat SHALL
appear at the top once its first answer arrives.

#### Scenario: A new chat tops the latest chats

- **GIVEN** the user has older chats
- **WHEN** the user's new chat gets its first answer
- **THEN** "How many open tickets do I have?" appears at the top of the latest chats

### Requirement: The full list holds every chat

The full list of chats SHALL hold all of the user's chats, newest first, a page at a time, with a
way to load older ones until every chat shows.

#### Scenario: Older chats load until all show

- **GIVEN** the user has 120 chats
- **WHEN** the user opens the full list and loads older ones twice
- **THEN** all 120 show, and there is nothing more to load

### Requirement: Open a saved chat and carry on

Opening a chat SHALL show its questions and answers in Ask, at an address of its own, and asking
SHALL add to that chat. A chat that cannot be found SHALL say so and offer a new chat.

#### Scenario: Carrying on yesterday's chat

- **GIVEN** the user's chat "How many open tickets do I have?" from yesterday
- **WHEN** the user opens it and asks "Which is the oldest?"
- **THEN** yesterday's question and answer show, and the new one is added to the same chat
