# Usable on Any Device Delta

## MODIFIED Requirements

### Requirement: Works on a phone

Every screen SHALL work on a phone-sized screen without the page scrolling
sideways. A list of rows reads as cards (see "Lists fit a phone"); other wide
content, such as a report's table, may scroll within its own area.

#### Scenario: Open a list on a phone

- **WHEN** the user opens a list of rows on a phone
- **THEN** the page fits the width of the screen
- **AND** each row is a card, so nothing scrolls sideways

#### Scenario: Open a wide report on a phone

- **WHEN** the user opens a report whose table is wider than a phone
- **THEN** the page fits the width of the screen
- **AND** the report's table scrolls sideways on its own

## ADDED Requirements

### Requirement: Easy to read in bright light

All text, including small secondary text such as dates and hints, and the edges of boxes the user types into SHALL
stand out clearly from their background, in light and in dark mode.

#### Scenario: Read a hint on a sunny shop floor

- **WHEN** the user reads the hint under a field on a phone in a bright shop
- **THEN** the hint is as easy to make out as the field's own label, in light and in dark mode

### Requirement: Comfortable to tap on a phone

Every control SHALL be large enough to tap with a thumb on a phone, and tapping into a box to type SHALL NOT make the
page zoom in.

#### Scenario: Type an employee code on a phone

- **WHEN** the user taps a text box on a phone and starts typing
- **THEN** the page stays at its size, and the box and the buttons near it are easy to hit with a thumb

#### Scenario: Tap a menu row, a link or a checkbox on a phone

- **WHEN** the user taps a row of the menu, a breadcrumb, a checkbox or any other control on a phone
- **THEN** its tap area is at least 44 pixels each way, while under a mouse the screen keeps its compact size
- **AND** only a link inside a sentence, or the small remove mark inside a chip (32 pixels, so it cannot reach the next
  chip), is smaller

### Requirement: Amounts, counts and dates read the Indian way

Amounts SHALL show in rupees with Indian digit grouping; a summary amount reads in lakh or crore, and an amount that
must add up or be paid shows exactly. Counts use Indian grouping and dates show the day, a short month name and the
year.

#### Scenario: A summary amount

- **WHEN** a report summarises sales of one lakh twenty-one thousand rupees
- **THEN** it reads ₹1.21 L, and the date beside it reads like 21-Oct-2026

### Requirement: Lists fit a phone

The rows of a list SHALL be readable on a phone without scrolling sideways, each row showing its most important
details stacked.

#### Scenario: Read a list of checklist runs on a phone

- **WHEN** the user opens a list on a phone
- **THEN** each row shows its title, its status in words and its key figures, without sideways scrolling

#### Scenario: Work with a Table's rows on a phone

- **WHEN** the user opens any Table's list on a phone
- **THEN** each row is a card led by the row's title, which opens the row, never by an opaque id
- **AND** the card shows its status in words and each other listed column as a labelled figure
- **AND** the user can still select rows one at a time or all on the page, act on them in bulk, sort by any listed
  column from a "Sort by" control, show a row's nested rows in place, and page through the rows

### Requirement: Screens say when they are loading, empty or failed

Every screen SHALL show in words when it is still loading, when there is nothing yet (with the way forward), and when
something failed, and SHALL confirm in words that an action worked. A blank space or a zero never stands in for any of
these.

#### Scenario: An empty list

- **WHEN** the user opens a list that has no rows yet
- **THEN** they are told it is empty and offered the way to add the first row
