# Report Standard

This folder stores local analysis reports generated during repository inspection.

The current standard is meant to serve two purposes:

- help future report generation follow the same structure
- help report readers understand how to read, compare, and trust the contents

## Purpose

These reports are intended to capture system analysis in a format that is:

- structured
- evidence-based
- easy to scan
- reusable across different system areas

They are not meant to be raw notes. Each report should answer a bounded analysis question and show both the high-level conclusion and the concrete code evidence behind it.

## Format

The current preferred format is `JSON`.

Why JSON is preferred:

- it keeps categories and checklist items well organized
- it is easy to diff mentally and programmatically
- it works well for repeated standards across many reports
- it can later be consumed by tooling if needed

Markdown can still be used when the request is more narrative than structural, but for system audits and architectural analysis, JSON is the default standard so far.

## Naming

Each report file should use a timestamped filename.

Pattern:

```text
YYYY-MM-DD_HH-mm-ss.<topic>.json
```

Examples:

- `2026-03-22_13-04-47.process-management-analysis.json`
- `2026-03-22_13-08-58.http-request-execution-analysis.json`

This helps keep reports:

- sortable by creation time
- easy to compare historically
- unique without extra coordination

## Folder Placement

Reports should be placed by domain under `report/`.

Examples of current organization:

- `report/system/processes/`
- `report/system/http/`
- `report/system/plugin/`
- `report/system/tenant/`
- `report/performance/`

Choose the folder based on the main subject of the analysis, not the file that happened to be open.

## Core Structure

Each JSON report should follow this shape:

```json
{
  "reportType": "string",
  "generatedAt": "ISO datetime with timezone",
  "scope": {
    "repository": "string",
    "area": "string",
    "coverage": ["string"]
  },
  "summary": {
    "overallAssessment": "string",
    "highLevelVerdict": "string"
  },
  "categories": {
    "categoryName": {
      "status": "string",
      "question": "string",
      "answer": "string",
      "evidence": [
        {
          "file": "path",
          "lines": [1, 2],
          "note": "string"
        }
      ],
      "itemsToGrantCorrectness": [
        {
          "item": "string",
          "result": "yes|no|partial"
        }
      ]
    }
  },
  "priorityView": {
    "mustFix": ["string"],
    "shouldFix": ["string"],
    "niceToHave": ["string"]
  }
}
```

## Field Meanings

### `reportType`

A stable identifier for the kind of report.

Examples:

- `process-management-analysis`
- `http-request-execution-analysis`

### `generatedAt`

An ISO timestamp including timezone offset.

This should reflect when the report was written, not only the filename timestamp.

### `scope`

Defines what the report is actually analyzing.

- `repository`: usually `ehecatl`
- `area`: the architectural zone being analyzed
- `coverage`: the specific lifecycle steps, subsystems, or concerns included

### `summary`

The short answer at the top.

- `overallAssessment`: a compact label like `good`, `partial`, `blocked`, `broken`, `incomplete`
- `highLevelVerdict`: one short paragraph describing the main conclusion

### `categories`

The main body of the report.

Each category should cover one meaningful concern, such as:

- launch and spawn
- route resolution
- response writing
- shutdown safety
- restart flow

Each category should answer one clear question.

### `evidence`

This is the grounding section.

Every important conclusion should point to concrete code locations. Each evidence item should include:

- file path
- relevant line numbers
- a short note explaining why that code matters

Evidence should support the answer, not just dump references.

### `itemsToGrantCorrectness`

This is the checklist section.

It should break the category into concrete verifiable claims, each answered with:

- `yes`
- `no`
- `partial` when truly needed

This section is especially useful when the user asks:

- what is required for this to be correct
- what is missing
- what is already safe

### `priorityView`

A short action-oriented closeout.

- `mustFix`: correctness or safety blockers
- `shouldFix`: important but not first-order blockers
- `niceToHave`: cleanup, ergonomics, observability, or follow-up improvements

This should stay concise and high signal.

## Writing Guidelines

When generating a report in this standard:

- analyze the real execution path, not just type names or comments
- prefer runtime behavior over intended architecture when they differ
- separate “implemented design” from “currently working behavior”
- call out blockers clearly when the flow cannot actually execute
- keep answers direct and specific
- support important conclusions with code evidence
- avoid vague labels without explanation

## Reader Guidelines

When reading one of these reports:

- start with `summary`
- then read `priorityView` if you want immediate action items
- then inspect `categories` for the detailed reasoning
- use `evidence` to jump into code and verify claims
- use `itemsToGrantCorrectness` as a compact audit checklist

The report is designed so a reader can either:

- scan quickly for decisions
- or drill down into file-backed justification

## Status Vocabulary

Use simple status language consistently.

Preferred labels:

- `good`: works as expected with no major concern found
- `mostly-good`: works overall, but has limited caveats
- `partial`: some important parts work, others do not
- `incomplete`: intended surface exists, but major behavior is missing
- `broken`: present but currently fails in important paths
- `blocked`: flow cannot be relied on because one or more upstream blockers prevent normal execution
- `needs-work`: usable insight exists, but correctness, reporting, or safety is weak

Choose the smallest honest label. Do not soften a blocker into `partial` if the path cannot really run.

## Scope Discipline

Each report should stay bounded.

Good reports answer one area, such as:

- process supervision
- HTTP request execution
- tenant app lifecycle
- plugin hook behavior

If the analysis grows into multiple independent systems, prefer separate reports instead of one oversized file.

## Updating the Standard

This file describes the standard used so far, not a frozen forever rule.

If future reports need a better shape, update this guide and keep the changes intentional. The important thing is consistency, evidence, and clear conclusions.
