# Debate Engine Regression Evals

Deterministic regression tests for debate engine output quality. These catch silent degradation from prompt template or parsing logic changes.

## Quick Start

```bash
npm run evals
```

## How It Works

Each JSON file in `evals/regression/` is a golden test case containing:

- **`mock_response`** — a known-good AI response string
- **`checks`** — structural assertions the parsed response must satisfy

The runner parses each mock response as JSON and validates it against the checks. No AI calls are made — this is pure deterministic pattern matching.

## Adding a New Case

Create a new `.json` file in `evals/regression/`:

```json
{
  "name": "my-new-case",
  "description": "What this case validates",
  "category": "opening | response | synthesis",
  "mock_response": "{\"statement\": \"...\", ...}",
  "checks": [
    { "type": "json_valid" },
    { "type": "has_fields", "fields": ["statement", "taxonomy_refs"] },
    { "type": "field_type", "field": "statement", "expected": "string" },
    { "type": "min_length", "field": "statement", "min": 50 },
    { "type": "array_min_length", "field": "my_claims", "min": 1 },
    { "type": "matches", "field": "taxonomy_refs.0.node_id", "pattern": "^(acc|saf|skp|cc)-" },
    { "type": "contains", "field": "statement", "substring": "regulation" },
    { "type": "array_items_have", "field": "taxonomy_refs", "required_fields": ["node_id", "relevance"] }
  ]
}
```

## Check Types

| Type | Fields | Description |
|------|--------|-------------|
| `json_valid` | — | Response parses as valid JSON |
| `has_fields` | `fields` | All listed fields exist on the parsed object |
| `field_type` | `field`, `expected` | Field has expected JS type (`string`, `array`, `object`, `number`, `boolean`) |
| `min_length` | `field`, `min` | String field has at least `min` characters |
| `array_min_length` | `field`, `min` | Array field has at least `min` elements |
| `matches` | `field`, `pattern` | Field value matches regex pattern |
| `contains` | `field`, `substring` | String field contains substring |
| `array_items_have` | `field`, `required_fields` | Every item in array has all listed fields |
| `not_empty` | `field` | Field is not null, undefined, empty string, or empty array |

Dot-notation is supported for nested fields: `taxonomy_refs.0.node_id` accesses the first element's `node_id`.

## What This Does NOT Cover

- LLM-as-judge quality assessment
- Safety/alignment evals
- Benchmark performance tracking
- Live AI backend testing

Those belong in separate eval suites when the use case demands.
