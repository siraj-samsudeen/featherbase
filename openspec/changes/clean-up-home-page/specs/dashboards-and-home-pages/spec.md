## MODIFIED Requirements

### Requirement: A home page groups links into cards

A home page SHALL show its links grouped into headed cards in the order
they were curated, and hide any link to a Table the viewer can't read rather
than showing it disabled. Links curated before the first named card still
sit under a heading.

#### Scenario: A hidden link

- **WHEN** a home page has a card with a link to a Table one viewer can't
  read
- **THEN** that viewer sees the card's other links but not that one

#### Scenario: Links before the first named card

- **WHEN** a Table is added to a home page that has no named cards
- **THEN** its link appears under a heading, not in a card with no title

## ADDED Requirements

### Requirement: Remembered places read as names

Wherever the home page or the sidebar points back to something the user
opened, it SHALL show that thing's name: a page by its title, and a row by its
title with its Table beneath. A row whose Table names no title column SHALL
read as a few of its own values instead, never as an internal id.

#### Scenario: A page remembered before page titles existed

- **WHEN** the user opened the cross-filter workspace before page titles were
  recorded, and later returns to the home page
- **THEN** the tile back to it shows the page's title, not its address

#### Scenario: A row whose Table has no title column

- **WHEN** the user opened a store's row in a merchandise map whose Table has
  no title column
- **THEN** the tile reads as the store code and the subcategory name, with the
  Table's name beneath, not as the row's internal id

### Requirement: The activity trail reads by day, one sentence per row

The activity trail SHALL group rows under the day they happened, naming the
two most recent days today and yesterday and the rest by weekday and date.
Each row SHALL read as one sentence that starts with who acted (the user
themselves in their own trail), says what kind of thing was acted on, and
shows the time.

#### Scenario: The user's own trail

- **WHEN** the user opened a page earlier today
- **THEN** their trail shows it under today, as "You opened" and the page's
  title, with the time it happened

### Requirement: A repeated action shows once

When the same person does the same thing to the same target several times
in a row, the activity trail SHALL show it once, with how many times and the
latest time. The same action separated by something else stays separate.

#### Scenario: Opening the same page twice in a row

- **WHEN** the user opens the same page twice in a row
- **THEN** their trail shows one row for it, marked as two times
