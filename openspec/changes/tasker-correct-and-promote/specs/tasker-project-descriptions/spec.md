## ADDED Requirements

### Requirement: project_markdown_is_shared
Status: governed (#296) · specified but unbuilt

> evidence: gap — project description tests pending.

A project SHALL show its shared Markdown description beneath its title under existing project permissions. Blank descriptions SHALL offer Add description. Edit SHALL expose Save and Cancel; empty content SHALL save. Saving SHALL retain the draft-start version, reject competing changes and retain the draft on failure. Cancel SHALL make no write. Reading or editing SHALL preserve project and task context, including mobile layouts.

#### Scenario: shared_context_and_empty_content
- **WHEN** a project editor saves a description or clears it
- **THEN** another editor reads the same persisted content and an empty value shows Add description.

#### Scenario: stale_project_draft
- **WHEN** another editor changes the project after a description draft begins
- **THEN** Save reports a conflict and does not overwrite the newer project.

### Requirement: markdown_cannot_execute_html
Status: governed (#296) · specified but unbuilt

> evidence: gap — Markdown rendering and XSS tests pending.

Descriptions SHALL render ordinary Markdown links, lists and code. Raw HTML SHALL not execute or create active DOM elements, and unsafe link protocols SHALL not execute code. Content SHALL remain readable without overflowing a 375px viewport.

#### Scenario: malicious_markup_is_inert
- **WHEN** a description contains script tags, event-handler HTML or a javascript link
- **THEN** it creates no executable script, handler or unsafe navigation URL.
