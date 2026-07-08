## ADDED Requirements

### Requirement: Provider-independent AI layer
The application SHALL access language models through a provider-abstraction interface supporting multiple cloud providers and local models, so that generators and workflows are written once against the abstraction. Provider credentials SHALL be stored securely on the user's machine and never written to workspace files or logs.

#### Scenario: Switch providers
- **WHEN** the user changes the configured provider or model
- **THEN** AI-assisted features use the new configuration without code changes or restart

#### Scenario: No provider configured
- **WHEN** no AI provider is configured
- **THEN** non-AI features work fully and AI-assisted actions explain how to configure a provider instead of failing

#### Scenario: Credentials kept out of workspace
- **WHEN** a provider API key is saved
- **THEN** it is stored in OS-appropriate secure storage and does not appear in workspace files, exports, or logs

### Requirement: Streaming responses
AI-generated output SHALL stream incrementally to the interface rather than blocking until completion, and the user SHALL be able to cancel an in-flight generation.

#### Scenario: Incremental display
- **WHEN** an AI-assisted action produces output
- **THEN** text appears incrementally as it is generated

#### Scenario: Cancel generation
- **WHEN** the user cancels an in-flight generation
- **THEN** streaming stops promptly and no partial result is saved without the user's consent

### Requirement: Response caching with provenance
The application SHALL cache AI responses keyed by input content and model, serve unchanged requests from cache, and record model, timestamp, and cache status as provenance on every AI-produced artifact.

#### Scenario: Cache hit
- **WHEN** an AI generation is requested whose inputs and model match a cached response
- **THEN** the cached response is returned without a provider call and its provenance shows cache status

#### Scenario: Inputs changed
- **WHEN** the inputs to a previously cached generation have changed
- **THEN** a fresh provider call is made and the cache entry is replaced

### Requirement: Document-embedded AI workflows
The application SHALL embed AI assistance in documentation workflows — at minimum: explain a selected document section or source region, summarize a document or recent repository changes, and draft updates to a document section — with results presented as reviewable document content rather than a chat transcript.

#### Scenario: Explain selection
- **WHEN** the user invokes explain on selected document or source content
- **THEN** an AI-generated explanation is shown alongside the selection with provenance

#### Scenario: Draft update requires approval
- **WHEN** an AI workflow drafts a change to an authored document section
- **THEN** the draft is presented for review and is applied to the file only after the user accepts it
