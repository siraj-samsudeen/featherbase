## ADDED Requirements

### Requirement: The page lists the places an app gives the person, with reasons

When an app provides people's scope, the page SHALL list each place it gives
the person today, by its label, with the reasons the app gives for it and the
days each reason holds from and to where the app knows them. A place the app
gives no reason for SHALL say so. The page SHALL never show a place's filter
values. When the app gives the person no places, the page SHALL say why: it
is not set up yet, it could not answer, or it gives them none.

#### Scenario: A place with a dated reason

- **GIVEN** the scope app places a person in South / Mens because of a Team
  Leader job assignment from 6 Aug 2026
- **WHEN** someone who may open the person's page opens it
- **THEN** it lists "South / Mens — Team Leader job assignment from
  06-Aug-2026"

#### Scenario: A place with no reason

- **GIVEN** the scope app places a person in North / Kids and gives no reason
- **WHEN** the page is opened
- **THEN** it lists "North / Kids — no reason given by" the app

#### Scenario: The app is not set up yet

- **GIVEN** the scope app needs an identifier system the instance lacks
- **WHEN** the page is opened
- **THEN** it says the app is not set up yet, and still shows the person's
  roles, Tables, limits and shares
