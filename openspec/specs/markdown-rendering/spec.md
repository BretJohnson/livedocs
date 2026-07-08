## Purpose

Define LiveDocs' structured Markdown rendering pipeline, code highlighting, document navigation, and readable presentation.

## Requirements

### Requirement: Structured Markdown pipeline
The application SHALL render Markdown through a structured document transformation pipeline (parse to AST, transform, render) rather than direct string-to-HTML conversion, so that generated sections, diagrams, and future transforms can operate on the document tree.

#### Scenario: CommonMark and GFM rendering
- **WHEN** a document containing CommonMark and GitHub Flavored Markdown constructs (tables, task lists, strikethrough, autolinks) is opened
- **THEN** all constructs render correctly in the reading view

#### Scenario: Pipeline extensibility
- **WHEN** a document contains a fenced code block whose language is claimed by a registered transform (e.g., `mermaid`)
- **THEN** the pipeline dispatches that node to the registered transform instead of rendering it as plain code

### Requirement: Syntax highlighting for code blocks
The application SHALL syntax-highlight fenced code blocks for common programming languages.

#### Scenario: Highlighted code block
- **WHEN** a document contains a fenced code block with a recognized language tag
- **THEN** the code renders with syntax highlighting for that language

#### Scenario: Unknown language falls back
- **WHEN** a code block has no language tag or an unrecognized one
- **THEN** the code renders as plain monospaced text without error

### Requirement: Document navigation
The application SHALL generate a table of contents from a document's headings and support navigation within and between documents.

#### Scenario: Table of contents
- **WHEN** a document with multiple headings is opened
- **THEN** a table of contents is displayed and clicking an entry scrolls to that heading

#### Scenario: Relative cross-document links
- **WHEN** the user clicks a relative link to another Markdown file in the workspace
- **THEN** the application opens that document in the reading view (including anchor targets when present)

#### Scenario: External links
- **WHEN** the user clicks an external (http/https) link
- **THEN** the link opens in the system browser, not inside the application

### Requirement: Readable presentation
The application SHALL present documents with typography and layout optimized for reading technical documentation, including light and dark themes.

#### Scenario: Theme switching
- **WHEN** the user switches between light and dark themes
- **THEN** documents, code blocks, and diagrams render legibly in the selected theme
