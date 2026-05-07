# rmp.ca — Claude Code guide

## Retrieval

Before editing code that touches existing behavior, run `mcp__claude-context__search_code` with a **behavioral query** (describe what the code *does*, not what it's *named*) and review the top 5 hits. Use grep/ast-grep for exact symbol lookups after semantic search, not before. This matters because the index retrieves cross-language relationships (e.g. a routing constraint that spans a Python solver, a React Native map component, and a TypeScript cost router) that ripgrep from a cold start will miss.

Known limitation: conjunction queries ("X and Y edge case") return split results rather than the junction. For those, run two separate searches and intersect manually.

Index: `~/.context/mcp-codebase-snapshot.json` · Milvus collection: `code_chunks_b722dfab` · 553 files · 7 570 chunks · last indexed 2026-04-25.

## Stack

React Native (Expo) mobile app · FastAPI Python backend · WatermelonDB offline sync · Valhalla + OSRM routing · PostGIS CPP/MC-CARP solver · Firebase Auth + App Check · Zilliz/Milvus semantic index.

# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
