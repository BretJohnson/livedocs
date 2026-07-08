# LiveDocs

**Tagline:** *Review software without reading code.*

**Product thesis:** For decades, source code has been the primary way humans understand software. In the AI era, that no longer scales. Humans need a representation of software that is optimized for understanding rather than implementation. LiveDocs is that representation.

---

# Vision

Software is increasingly created with AI assistance. As AI takes on more of the implementation work, humans spend less time reading source code—but they remain responsible for ensuring that the software behaves correctly.

Whether the creator is an experienced engineer, a founder, a product manager, or someone with little programming experience, they still need confidence that the application matches their intent.

Humans need to understand:

- What the application does
- How users interact with it
- The database schema
- APIs and integrations
- Security model and permissions
- Architecture and service boundaries
- Recent changes and their impact

Today, the primary way to answer these questions is to read source code or manually exercise the application. Neither approach scales well as applications become larger and increasingly AI-generated.

LiveDocs proposes a different model.

Instead of making source code the primary interface for understanding software, LiveDocs generates and maintains a human-readable representation of the system. It combines authored documentation, repository analysis, diagrams, generated summaries, and AI-assisted explanations into a single place where people review the software itself.

Source code remains the implementation.

LiveDocs becomes the primary interface for human understanding.

---

# Product Philosophy

## Humans review understanding, not implementation

The goal of LiveDocs is not to eliminate source code. Engineers will always inspect implementation details when necessary.

Instead, LiveDocs should allow most software review to happen at a higher level of abstraction. People should be able to understand what the software does and whether it matches their intent without needing to read thousands of lines of implementation.

## Maximize human understanding

Traditional documentation often tries to avoid duplicating information already present in code.

LiveDocs intentionally takes the opposite approach when it improves comprehension.

If a generated database schema, API catalog, UI flow, permission matrix, or architecture diagram helps humans understand the system, it is valuable even if that information ultimately originates from the source code.

The objective is not to minimize duplication.

The objective is to maximize understanding.

## Markdown remains the durable foundation

Markdown should remain the primary authored format because it is portable, durable, version-controlled, and broadly supported.

LiveDocs enhances Markdown rather than replacing it.

## AI is a collaborator

AI should help generate, maintain, organize, explain, and review documentation. The primary artifact remains the documentation and software model—not a chat transcript.

## Generated content should be trustworthy

Generated content should clearly indicate provenance including inputs, generation time, cache status, and (where applicable) the model that produced it.

---

# Primary Users

People responsible for software, including:

- Software engineers
- Founders
- Product managers
- Architects
- QA engineers
- Security reviewers
- Technical writers
- AI coding agents

Their common goal is to answer:

> "Does this software do what we intended?"

---

# Core Use Cases

- Review an application's current behavior without reading implementation code.
- Review AI-generated changes before shipping.
- Understand an unfamiliar repository.
- Generate architecture, API, database, UI, and security documentation.
- Keep documentation synchronized with evolving software.
- Produce research, planning, and design documents.
- Detect stale or missing documentation.

---

# Core Capabilities

## Excellent Markdown Experience

Provide a best-in-class experience for reading technical documentation.

## Live Documentation

Support authored Markdown alongside dynamically generated sections such as architecture summaries, API indexes, dependency graphs, UI flows, and database schemas.

## Visual Understanding

Generate and display diagrams whenever they communicate information more effectively than prose.

## AI-Assisted Workflows

Embed AI into documentation workflows—for explanation, planning, updating, reviewing, and summarizing—rather than centering the experience around chat.

---

# Suggested Architecture

The following technologies are suggestions, not requirements.

## Desktop

- Electron
- React
- TypeScript
- Vite

## Markdown Pipeline

- unified
- remark
- rehype

Favor a structured document transformation pipeline over simple Markdown-to-HTML rendering.

## Repository Analysis

- Git integration
- File watching
- Source indexing
- Dependency analysis
- Repository search

## Diagram Support

- Mermaid
- Graphviz
- PlantUML
- D2

## AI Layer

Provider-independent with support for multiple cloud and local models, streaming, caching, and provenance.

## Local Storage

Suggested: SQLite for indexes, caches, metadata, generated artifacts, and search.

---

# Long-Term Vision

LiveDocs is more than a Markdown viewer.

It is the human-readable representation of a software system.

As AI increasingly writes implementation code, LiveDocs should become the preferred place for humans to understand, review, and validate software before it ships.

---

# Request to the Implementing LLM

Treat this document as a product vision rather than a fixed specification.

Improve the architecture where appropriate.

Recommend alternative technologies if they offer meaningful advantages.

Identify missing capabilities and simplify unnecessary complexity.

Design LiveDocs to evolve into the best platform for understanding and reviewing software in the AI era.
