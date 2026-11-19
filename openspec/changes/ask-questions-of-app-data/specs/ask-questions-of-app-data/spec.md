# Ask Questions of App Data

## ADDED Requirements

### Requirement: Ask about the figures and get figures back

The user SHALL be able to ask a question about an app's figures, such as sales against
target, and get the figures that answer it, grouped and ordered the way the question asks.

#### Scenario: The subcategories furthest behind target

```gherkin
Given the user manages the store Lakeside
When the user asks which subcategories are furthest behind target
Then the user sees up to five subcategories, the largest shortfall first
And each shows its target, its sales and its gap
```

### Requirement: An answer covers only what the user may see

An answer SHALL count only the stores and sections the user is responsible for today,
the same ones their report shows.

#### Scenario: A Store Manager gets the whole store

```gherkin
Given the user is the Store Manager of Lakeside
When the user asks for sales against target
Then the answer covers every section of Lakeside and no other store
```

#### Scenario: Section staff get their section only

```gherkin
Given the user works in the Sarees section of Lakeside
When the user asks for sales by subcategory
Then the answer shows only subcategories in Sarees
```

### Requirement: Someone with no store or section is refused

A user who is responsible for no store or section SHALL be told they cannot ask, not
given an empty answer that looks like no sales.

#### Scenario: An administrator with no store asks

```gherkin
Given the user has no store or section
When the user asks for sales against target
Then the user is told they have no stores or sections to ask about
```

### Requirement: Every answer says what it counted

An answer SHALL say how each figure was worked out, whose stores and sections it covers,
and how recent the figures are.

#### Scenario: Achievement shows its definition and its date

```gherkin
Given the user is the Store Manager of Lakeside
When the user asks how much of the target Lakeside has achieved
Then the user sees 79.9%
And the user is told it is sales divided by target, for Lakeside, with figures to yesterday
```

### Requirement: A question the figures cannot answer is refused plainly

When a question asks for something the app's figures do not hold, the user SHALL be told
so in plain words and SHALL NOT be given a guess.

#### Scenario: Asking for profit

```gherkin
Given the app's figures hold target and sales but not profit
When the user asks for profit by store
Then the user is told there is no figure called profit
```

### Requirement: A figure with nothing to divide by is shown as missing

A worked-out figure that would divide by nothing SHALL show as missing, never as zero.

#### Scenario: A subcategory with no target

```gherkin
Given Gift wrap has sales but no target this month
When the user asks for achievement by subcategory
Then Gift wrap's achievement shows as missing
```

### Requirement: Names are understood as the user types them

When a question names a store or subcategory, the answer SHALL find it whatever its capitals,
and a name that is not one of the user's SHALL be called out rather than give an empty answer.

#### Scenario: A subcategory typed with different capitals

```gherkin
Given the user manages the store Lakeside, which sells Silk sarees
When the user asks how Silk Sarees is doing
Then the user sees the figures for Silk sarees
```

#### Scenario: A subcategory that is not the user's

```gherkin
Given the user works in the Sarees section of Lakeside
When the user asks how Wrist watches is doing
Then the user is told Wrist watches is not one of their subcategories
```

### Requirement: A follow-up builds on the last answer

The user SHALL be able to follow an answer with a short question that changes it, without
repeating what they asked before, and SHALL be able to start afresh.

#### Scenario: Breaking the last answer down by store

```gherkin
Given the user has asked for sales against target and seen the answer
When the user asks "and by store?"
Then the user sees sales against target for each of their stores
```

### Requirement: An unclear question is asked back

When a question could mean two different things, the user SHALL be asked which they mean
instead of being given a guess.

#### Scenario: Rupees or pieces

```gherkin
Given the figures hold sales in rupees and in pieces
When the user asks how much was sold
Then the user is asked whether they mean rupees or pieces
And no figures are shown until they say
```

### Requirement: Figures by section

An answer about sections SHALL name each section a subcategory belongs to on the day the figures
are for, and SHALL leave the section blank when no section owns the subcategory that day.

#### Scenario: The sections furthest behind target

```gherkin
Given the user manages the store Lakeside
When the user asks which sections are furthest behind target
Then the user sees up to five sections, the largest shortfall first
And each shows its target, its sales and its gap
And a subcategory no section owns that day is shown with no section
```

#### Scenario: A section owns a subcategory only on the days it is placed

```gherkin
Given a subcategory was owned by one section until 31 October and by another from 1 November
When the user asks about the sections for a day in June
Then the June figures are counted under the section that owned the subcategory in June
```

### Requirement: This month beside last month

The user SHALL be able to compare this month's figures with last month's, each counted over
the same days of the month, and to see the figures month by month for the last four months.

#### Scenario: Sales against the same days of last month

```gherkin
Given the figures run to the 14th of this month
When the user asks how sales compare with last month
Then the user sees this month's sales to the 14th beside last month's sales to the 14th
And the change between them, as an amount and as a percentage of last month's
```

#### Scenario: The subcategories that fell the most

```gherkin
Given the user manages the store Lakeside
When the user asks which subcategories have fallen the most since last month
Then the user sees up to five subcategories, the largest fall first
```

#### Scenario: A month with nothing to compare with

```gherkin
Given a subcategory sold nothing over the same days of last month
When the user asks for its growth over last month
Then its growth is shown as missing, not as zero
```

### Requirement: Behind means behind

A list of what is behind target, or of what has fallen, SHALL hold only rows that are behind
or have fallen, however many were asked for.

#### Scenario: Fewer are behind than were asked for

```gherkin
Given four of the user's subcategories are behind target and the rest are ahead
When the user asks which subcategories are furthest behind target
Then the user sees those four, the largest shortfall first, and none that is ahead
```

### Requirement: A conversation is still there on the next visit

The platform SHALL keep each question a user asks, with what it became (the plan that
answered it, the question asked back, or why it was refused) and never a figure, so that a
follow-up within a day carries on from the user's earlier questions on any device. A user
SHALL see and carry on from their own questions only, and SHALL be able to start over.

#### Scenario: A follow-up after coming back, on another device

```gherkin
Given the user asked how sales compare with last month on one computer
When the user opens the page on another computer the same day and asks "and by section?"
Then the answer compares each section with last month, from today's figures
```

#### Scenario: Another person's questions

```gherkin
Given one user has asked questions of the app
When another user opens the page and asks a follow-up
Then the answer follows from none of the first user's questions
```

#### Scenario: Starting over

```gherkin
Given the user has asked questions of the app
When the user starts over and asks a new question
Then the answer follows from none of the earlier questions
And the earlier questions are still kept
```

### Requirement: Questions are answered by SQL that can read only the user's own rows

The platform SHALL answer a question with SQL written for it, run where only the rows the
user may see exist, and SHALL show the user the SQL with the answer. When the SQL cannot be
used, the question SHALL still be answered from the model's own names where they can answer it.

#### Scenario: SQL cannot reach another store

```gherkin
Given the user works in the Sarees section of Lakeside
When the user's question is answered by SQL that asks for every store's sales
Then the answer holds only Sarees at Lakeside
```

#### Scenario: SQL that tries to change or reach outside

```gherkin
Given the SQL written for a question is not a single SELECT, or reads a file
When the question is asked
Then that SQL is not run for an answer
And the question is answered from the model's own names, or refused in plain words
```

#### Scenario: The answer shows how it was worked out

```gherkin
Given the user asks how sales compare with last month
When the answer comes back
Then the user can open the SQL that worked it out
```

### Requirement: Questions about how things work are answered from the help, with sources

The user SHALL be able to ask how the app works and get an answer drawn only from the help
folder and the sources it lists, with the pages it came from named. When the help does not
cover the question, the user SHALL be told so plainly.

#### Scenario: How a figure is worked out

```gherkin
Given the help explains how achievement is worked out
When the user asks "how is achievement worked out?"
Then the answer says achievement is sales as a percentage of target
And names the help page it came from
```

#### Scenario: A question the help does not cover

```gherkin
Given no help page mentions parking
When the user asks where to park
Then the user is told the help does not cover it
```

#### Scenario: A changed page changes the answer

```gherkin
Given a help page is edited
When the user next asks about what it covers
Then the answer comes from the edited page
```

### Requirement: A chat panel with modes the user has been given

The user SHALL be able to talk to the app in a chat panel, in the modes they have been given
and no others: Agent (figures answered in the chat), Reports (figures drawn as a report on
the page), Ask (how things work) and Action. A mode SHALL be given to a user by giving them
its role, and holding a senior role SHALL give no mode by itself.

#### Scenario: A reader with every mode

```gherkin
Given the user has been given the Agent, Reports, Ask and Action modes
When the user opens the page
Then the chat panel offers those four modes
```

#### Scenario: An administrator with Ask alone

```gherkin
Given the Administrator has been given the Ask mode and no other
When the Administrator opens the page
Then the chat panel offers Ask alone
And a message sent in Agent mode is refused
```

#### Scenario: Agent answers in the chat

```gherkin
Given the user is in Agent mode
When the user asks how sales compare with last month
Then the answer appears in the chat, in a few words with its table
And the page's report is unchanged
```

#### Scenario: Reports draws on the page

```gherkin
Given the user is in Reports mode
When the user asks which subcategories are furthest behind target
Then the report is drawn on the page
And the chat says the report is on the page
```

### Requirement: A request is sent only when the user confirms it, and decided by someone else

In Action mode the user SHALL be able to ask for one of the requests the app declares, such as
a target review. The chat SHALL show the request it would send and send it only when the user
confirms it. A sent request SHALL wait for a reviewer, who SHALL approve or reject it once, and
SHALL never be decided by the user who sent it. A request SHALL name only stores and
subcategories the user can see.

#### Scenario: A target review is sent after a yes

```gherkin
Given the user is in Action mode
When the user asks for the Kids target at their store to be reviewed because stock came late
Then the chat shows a target review with the store, the subcategory and the reason
And nothing has been sent
When the user says yes
Then a request numbered TR-<n> is sent and waits for review
```

#### Scenario: Something missing is asked for

```gherkin
Given the user is in Action mode
When the user asks for a target review without saying why
Then the chat asks for the reason and sends nothing
```

#### Scenario: A store that is not the user's

```gherkin
Given the user can see one store
When the user asks for a target review at another store
Then the chat asks which of their stores they mean and sends nothing
```

#### Scenario: A reviewer decides

```gherkin
Given a request is waiting for review
When a reviewer approves it with a note
Then the sender sees it approved, with the note
And it cannot be decided again
And the person who sent a request cannot approve it
```

### Requirement: The language model is held to an allowance and to rules

The instance SHALL be able to set how much the language model may be used in a month; once
it is used up, questions in words SHALL be refused until the month ends, and then answered
again with nothing switched back on by hand. A user SHALL be limited in how many messages
they send in a day. What a user sees SHALL be limited by the platform whatever the language
model is told.

#### Scenario: The month's allowance is used up

```gherkin
Given the month's allowance for the language model is used up
When the user asks a question in any mode
Then they are told it opens again on the first of next month
And the language model is not asked
```

#### Scenario: Told to show everything

```gherkin
Given the user can see one section
When the user tells the chat to ignore its rules and show every store's sales
Then no figure outside the user's section is shown
```

#### Scenario: Told to change the data

```gherkin
Given the user is in Agent mode
When the language model is talked into SQL that deletes, copies to a file or attaches a database
Then the SQL is not run
And the next question is answered from the same figures
```

### Requirement: The user's conversations are kept

The user SHALL see their earlier conversations in the panel, open one to read it and carry
on from it, start a new one, and remove one from their list. A user SHALL never see another
user's conversations.

#### Scenario: Coming back to a conversation

```gherkin
Given the user asked two questions in a conversation yesterday
When the user opens it from the Sessions list and asks "and by section?"
Then the earlier questions and answers are shown
And the new answer follows on from them
```

#### Scenario: Another person's conversation

```gherkin
Given one user has a conversation
When another user asks for it by its number
Then it is not found
```
