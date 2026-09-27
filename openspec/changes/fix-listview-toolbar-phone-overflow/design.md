# Design

## Context

The generic ListView places its title block and all metadata-gated actions in one non-wrapping flex row. The inner action row also cannot wrap, so metadata that enables many views and management actions gives the Admin content area a width of more than 1100px at a 375px viewport. The rows table already uses a separate horizontal overflow container and must keep doing so.

The focused browser suite uses the shared Session DSL for supported navigation and assertions. Viewport changes, element measurements, and screenshots remain named measurement steps until those operations are integrated into the DSL.

## Goals / Non-Goals

**Goals:**

- Keep the Admin content area within its available width while every applicable ListView header action remains reachable.
- Preserve the existing desktop arrangement and the rows table's own horizontal scrolling.
- Exercise the largest metadata-driven toolbar shape at phone and desktop widths.

**Non-Goals:**

- Introduce a More menu, change action ordering, or change any action's visibility conditions or behavior.
- Change bulk selection or deletion behavior, the Admin shell, APIs, dependencies, or metadata contracts.

## Decisions

- Make the existing header stack at narrow widths and retain its current horizontal alignment at the desktop breakpoint. Let the existing action container wrap within the available width. This uses the established responsive flex utilities and `.fc-btn` controls without adding a component or interaction model.
- Keep all actions visible instead of introducing a More menu. Wrapping can contain independent button and link controls without reducing their touch targets, so a menu would add discovery, keyboard, and state complexity without solving an impossible layout.
- Add one metadata-rich Table fixture with Choice, two Date columns, and checklist metadata so the regression activates New, Report, Explore, Import, Columns, Merge, Kanban, Calendar, Gantt, and Checklist alongside the column picker.
- At both 375px and desktop width, measure that the Admin main element does not overflow and that every expected header control lies within the main element's horizontal bounds. Separately assert that the table overflow container remains the owner of any wide-row overflow. Keep these unsupported measurements in an explicitly named Session step; use Session operations everywhere they are supported.

## Risks / Trade-offs

- [Wrapped actions make the phone header taller] → Accept vertical growth so controls remain visible, named, and touch-sized.
- [A weak fixture could omit the widest action combination] → Assert the complete expected control set before measuring bounds.
- [A page-level measurement could mistake the intentional wide table for a regression] → Measure the Admin main and the table's dedicated overflow container independently.
- [Responsive changes could alter desktop spacing] → Cover desktop bounds and inspect phone and desktop screenshots while retaining the desktop breakpoint's original row alignment.
