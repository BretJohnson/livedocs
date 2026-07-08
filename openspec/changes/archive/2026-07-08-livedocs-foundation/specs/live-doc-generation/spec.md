## ADDED Requirements

### Requirement: Generated sections embedded in authored Markdown
The application SHALL support marked regions in authored Markdown documents (generated-section directives) whose content is produced by a named generator, rendered inline with the surrounding authored content. Authored text outside marked regions SHALL never be modified by generation.

#### Scenario: Directive renders generated content
- **WHEN** a document contains a generated-section directive referencing an available generator
- **THEN** the reading view renders the generator's current output inside that section

#### Scenario: Unknown generator
- **WHEN** a directive references a generator that does not exist
- **THEN** the section renders an inline error identifying the unknown generator and the rest of the document renders normally

#### Scenario: Authored content preserved
- **WHEN** a generated section is refreshed
- **THEN** all authored content outside the marked region is byte-for-byte unchanged

### Requirement: Foundation generators
The application SHALL ship with generators that produce, from repository analysis: an architecture/module overview, an API index of exported symbols, a dependency graph diagram, and a database schema summary when schema definitions are detectable in the workspace.

#### Scenario: Dependency graph generated
- **WHEN** the user inserts a dependency-graph section in a workspace with analyzable dependencies
- **THEN** the section renders a diagram of module or package dependencies derived from the repository index

#### Scenario: No analyzable input
- **WHEN** a generator's required input is absent from the workspace (e.g., no detectable database schema)
- **THEN** the section states that no input was found rather than rendering empty or fabricated content

### Requirement: Regeneration on change
The application SHALL detect when a generated section's inputs have changed since it was produced, mark the section stale, and refresh it on user request or automatically per workspace policy.

#### Scenario: Stale section marked
- **WHEN** source files that a generated section depends on change after generation
- **THEN** the section is visibly marked stale in the reading view

#### Scenario: Manual refresh
- **WHEN** the user triggers refresh on a stale section
- **THEN** the generator re-runs against current repository state and the section updates

### Requirement: Provenance on generated content
Every generated section SHALL carry inspectable provenance: the generator identity, generation timestamp, input summary, cache status, and the model used when AI was involved.

#### Scenario: Provenance inspection
- **WHEN** the user inspects a generated section's provenance
- **THEN** the application shows what produced it, when, from which inputs, whether it was served from cache, and the model if AI-generated

#### Scenario: Generated content visually distinguished
- **WHEN** a document mixes authored and generated content
- **THEN** generated sections are visually distinguishable from authored content in the reading view
