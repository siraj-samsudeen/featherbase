# Dashboards and Home Pages Delta

## MODIFIED Requirements

### Requirement: A dashboard's numbers and charts stay live

Opening a dashboard SHALL compute each card's count and each chart's values
fresh from current data, scoped to what the viewer could otherwise read.

#### Scenario: A restricted viewer's card

- **WHEN** a dashboard has a card counting all Orders, and a viewer can only
  read their own
- **THEN** that viewer's card counts only their own orders, not everyone's
