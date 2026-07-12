## MODIFIED Requirements

### Requirement: Browse workspace documents and files
The application SHALL display a navigable tree of the workspace's contents, distinguishing documentation files (Markdown) from source and other files, and SHALL open documents in the reading view when selected. The docs-focused view SHALL include only Markdown files selected by the active workspace's document visibility configuration and defaults, while the full file tree SHALL remain governed by the existing repository path-ignore behavior.

#### Scenario: Select a Markdown document
- **WHEN** the user selects a visible Markdown file in the workspace tree
- **THEN** the application renders it in the reading view

#### Scenario: Documentation-first navigation
- **WHEN** the workspace contains Markdown documents selected by the active document visibility rules
- **THEN** the tree presents them prominently in a docs-focused view while still allowing access to the full file tree

#### Scenario: Hidden document is omitted from docs navigation
- **WHEN** a Markdown file is not selected by the active document visibility rules
- **THEN** the docs-focused view omits that file and any directory branches left empty by its omission
- **AND** the file remains available in the full file tree when existing repository ignore rules permit it

