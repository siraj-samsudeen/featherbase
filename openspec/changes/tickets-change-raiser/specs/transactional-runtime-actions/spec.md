# Transactional Runtime Actions

## ADDED Requirements

### Requirement: An action can ask who is enabled

An app's action or read SHALL be able to ask which of some people are enabled, as far as the calling person may see them. A built-in account, a person merged into another, and a service account are never enabled people.

### Requirement: A System Manager's action can hand over one of the app's own rows

An action SHALL be able to make an enabled person the creator of one row of a Table the app owns, so that a grant on rows a person created follows the row. The host SHALL refuse this when the calling person does not hold the System Manager role, and for a Table the app does not own.
