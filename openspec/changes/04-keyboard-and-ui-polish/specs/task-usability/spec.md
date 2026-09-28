# Everyday usability

## Purpose

Make the project-management application efficient with a keyboard, clear during failure and usable across screen sizes and assistive technologies.

## ADDED Requirements

### Requirement: Complete actions with the keyboard

All Todo and Project actions MUST work with keyboard controls and logical tab order. Enter inside a create or rename title input MUST submit once. Escape in a rename editor MUST cancel without saving. Opening rename MUST focus its title input. After create, save, cancel, delete, recovery or conflict review, focus MUST settle on a connected, enabled, visible control appropriate to the next action, not the page body or a disabled input. No focus trap is allowed. Render-frame settling is allowed; persistent focus loss is not.

#### Scenario: Work without a mouse
- **WHEN** I create with Enter, rename with Enter, cancel another rename with Escape and delete a record
- **THEN** each intended action occurs once, cancellation changes nothing saved, and focus remains useful after each transition.

### Requirement: Explain the current state

Loading, pending mutation, success, failure and uncertainty MUST be distinguishable. Feedback MUST describe the current operation; stale success and Saving messages MUST clear when superseded. Invalid fields MUST expose their invalid state and associated explanation. Status and error announcements MUST avoid duplicate conflicting alerts. Conflict review MUST display latest saved values beside proposed replacements while retaining editable input.

#### Scenario: Correct and retry
- **WHEN** a previous successful action is followed by validation failure, a lost reply or a conflict
- **THEN** I see the current problem and usable recovery controls, not obsolete success or Saving feedback, and can finish by keyboard without losing my draft.

### Requirement: Remain accessible and responsive

Controls MUST have accessible roles, names and states, visible focus and non-color-only meaning. Layout MUST remain usable from 320–1440 CSS pixels and at 200% browser zoom, with long titles and no clipped actions, overlapping content or page-wide horizontal scrolling. Screen-reader users MUST be able to identify controls, errors and outcomes. Lists, forms and feedback MUST use consistent spacing, typography and action hierarchy.

#### Scenario: Use a small or enlarged interface
- **WHEN** I navigate at a 390-pixel width or at 200% zoom with long titles
- **THEN** every action remains visible and operable, and labels and errors remain associated with their fields.
