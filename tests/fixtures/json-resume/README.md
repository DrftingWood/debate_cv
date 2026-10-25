Official JSON Resume schemas (MIT, (c) JSON Resume), vendored so the
validation test runs offline:

- `schema-v1.0.0.json`: https://raw.githubusercontent.com/jsonresume/resume-schema/v1.0.0/schema.json
  (draft-04; top-level `additionalProperties: false`). The document's `$schema` points here.
- `schema-1.3.1.json`: `schema.json` from npm `@jsonresume/schema@1.3.1` (2026-07-22), the
  current release, now published from the jsonresume/jsonresume.org monorepo (draft-07;
  top-level `additionalProperties: true`).

Fetched 2026-10-20. Refresh by re-downloading both and re-running
`tests/cv.jsonResume.schema.test.ts`.
