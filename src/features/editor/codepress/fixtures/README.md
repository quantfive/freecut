# PR1 conformance fixtures

These are the language-neutral CodePress PR1 fixtures copied into the
FreeCut-side adapter test surface. They are intentionally limited to the
stable wire fields: no FreeCut paths, blob URLs, workspace handles, or raw
media bytes are included. The adapter tests load them as JSON so the same
validation, command order, and structured conflict shapes can be checked from
the fork without importing the CodePress repository.
