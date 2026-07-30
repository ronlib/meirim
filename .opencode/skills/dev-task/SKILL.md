---
name: dev-task
description: Use when working on any non-trivial development task — feature, refactor, or bugfix. Follows a structured process: explore, plan, implement (TDD), review, document.
---

# Skill: dev-task

Follow this structured workflow for any non-trivial development task.

## Workflow

Each phase is delegated to a dedicated subagent. The subagent that **implements** is never the same subagent that **reviews** — each gets a fresh `task_id` to guarantee separation.

### 1. Explore

Launch an **`explore`** subagent tasked with:

- Searching the codebase thoroughly for all relevant files, patterns, conventions, and existing tests.
- For bugfixes: reproducing the bug first, then understanding the root cause.
- For features: finding the closest existing patterns to follow.
- Checking `AGENTS.md` if it exists for project-specific rules.

**Output**: A written summary of findings — all relevant file paths, key code snippets, conventions observed, and test locations.

### 2. Ask Questions

This phase stays with **the main agent** (you) since it requires direct user interaction.

Before writing code, identify critical decisions. Ask the user:

- Architecture / approach tradeoffs
- Edge cases and failure modes
- Acceptance criteria (what "done" means)
- Test strategy preferences
- Any ambiguous requirements

Do **not** ask about things already decided or obvious from exploration.

### 3. Plan

Launch a **`general`** subagent (fresh `task_id`) and pass it the exploration summary. Task it with producing a brief plan covering:

- Files to create or modify
- Approach / design decisions
- **Test plan**: what tests are needed, what they cover, and how to run them

**Output**: The plan as structured text. Wait for user approval before proceeding.

### 4. Implement (TDD)

Launch a **`general`** subagent (fresh `task_id`, different from plan/review) and pass it the approved plan. Task it with:

For each unit of work:

1. **Write a failing test first** — commit or checkpoint it if the project uses version-control based testing.
2. **Implement the code** to make the test pass.
3. **Verify** all tests pass (both new and existing).
4. **Refactor** if needed — keep tests green.

**Output**: Summary of what was implemented, including file paths and any verification results.

### 5. Self-Review

Launch a **`general`** subagent (fresh `task_id`, *must* be different from the implement agent) and pass it:

- The implementation summary from phase 4
- The full `git diff` output

Task it with:

- Re-reading the diff critically.
- Checking for: dead code, missing error handling, security issues, performance pitfalls, consistency with codebase conventions.
- Running linter and type checker if the project has them.
- Filing any issues found (either fixing them directly or reporting back).

**Output**: Review report — issues found, fixes applied, or an all-clear.

### 6. Documentation

Update `./docs` (including `AGENTS.md` if applicable) if the task introduces new patterns, conventions, or important gotchas for future work.

### 7. Commit

Create a single well-structured commit with all the changes. Use `git add -A` and a concise commit message that matches the repo style.
