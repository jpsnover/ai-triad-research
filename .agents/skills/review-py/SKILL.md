---
name: review-py
description: Self-review Python code against the project's Python Packages Code Review Guide. Run before reporting work as done.
---

Review your recent Python changes against the project's code review guide.

1. Read `docs/CodeReview/Python Packages Code Review Guide.md`
2. Identify which files you changed in this session
3. For each changed file, check against all applicable sections of the guide:
   - Resource lifecycle (context managers, no unclosed handles)
   - Input validation (parameterized queries, no shell=True with dynamic input)
   - Anthropic SDK (timeouts, streaming, tool descriptions)
   - Sentence-transformers (no trust_remote_code=True, batched processing)
   - HTTP clients (explicit timeouts, session pooling, bounded concurrency)
   - Rate limiting (exponential backoff with jitter, max retries)
   - Trafilatura (execution timeouts, chunked ingestion)
   - MarkItDown (no user input to convert(), scoped install)
   - PDF parsers (correct library selection, no legacy imports)
   - GitPython (context manager for Repo, validate SSH commands)
   - Numpy (vectorization, views over copies)
4. Report any findings with severity (CRITICAL/WARNING/INFO), file:line, and specific fix
5. Fix any CRITICAL issues before reporting done