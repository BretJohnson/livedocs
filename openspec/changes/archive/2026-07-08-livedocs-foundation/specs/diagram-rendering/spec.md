## ADDED Requirements

### Requirement: Extensible diagram renderer interface
The application SHALL route diagram code blocks through a renderer registry keyed by language tag, so that new diagram formats (Graphviz, PlantUML, D2) can be added without changes to the Markdown pipeline.

#### Scenario: Registered format renders
- **WHEN** a fenced code block uses a language tag with a registered diagram renderer
- **THEN** the block renders as a diagram in place of the code

#### Scenario: Unregistered format degrades gracefully
- **WHEN** a fenced code block uses a diagram-like language tag with no registered renderer (e.g., `plantuml` before support exists)
- **THEN** the block renders as a plain code block without error

### Requirement: Mermaid rendering
The application SHALL render Mermaid diagrams embedded in Markdown documents.

#### Scenario: Valid Mermaid diagram
- **WHEN** a document contains a ` ```mermaid ` code block with valid syntax
- **THEN** the rendered diagram appears in the document at that position

#### Scenario: Invalid Mermaid source
- **WHEN** a Mermaid code block contains invalid syntax
- **THEN** the application shows an inline error with the original source visible, and the rest of the document still renders

### Requirement: Diagram viewing controls
The application SHALL let the user view diagrams at a usable size, including enlarging diagrams that exceed the reading column.

#### Scenario: Enlarge a diagram
- **WHEN** the user activates a rendered diagram (e.g., clicks it)
- **THEN** the application presents an enlarged view with zoom and pan
