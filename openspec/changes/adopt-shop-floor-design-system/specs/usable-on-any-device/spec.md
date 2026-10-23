# Usable on Any Device Delta

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

### Requirement: Screens say when they are loading, empty or failed

Every screen SHALL show in words when it is still loading, when there is nothing yet (with the way forward), and when
something failed, and SHALL confirm in words that an action worked. A blank space or a zero never stands in for any of
these.

#### Scenario: An empty list

- **WHEN** the user opens a list that has no rows yet
- **THEN** they are told it is empty and offered the way to add the first row
