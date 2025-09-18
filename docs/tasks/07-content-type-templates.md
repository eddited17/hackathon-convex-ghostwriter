# Task 07 — Content-Type Templates & Prompt Enrichment

## Summary
Expand blueprint support with rich templates per content type (blog post, article, biography), ensuring prompts and drafting respect structure and tone presets.

## Key Requirements
- Store template definitions in Convex (sections, tone guidance, word count targets, sample language).
- Build management UI to preview and tweak templates (admin-friendly even if behind feature flag).
- Update prompt builder (used in Tasks 03 & 05) to inject template-specific instructions.
- Allow projects to override template defaults (e.g., custom outline) while preserving base structure.

## Deliverables
- Convex table or configuration loader for templates.
- UI components to display active template and request adjustments.
- Tests verifying prompt assembly selects appropriate template blocks.

## Acceptance Criteria
- Selecting a content type automatically applies the correct template in prompts and draft output.
- Template adjustments persist per project and influence subsequent drafts.
- Lint/type/build checks pass.

## References
- PRD §7.6 (`docs/prd/ai-ghostwriter-prd.md`).
- Implementation Plan §3 (third bullet).
