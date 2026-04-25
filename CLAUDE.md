# rmp.ca — Claude Code guide

## Retrieval

Before editing code that touches existing behavior, run `mcp__claude-context__search_code` with a **behavioral query** (describe what the code *does*, not what it's *named*) and review the top 5 hits. Use grep/ast-grep for exact symbol lookups after semantic search, not before. This matters because the index retrieves cross-language relationships (e.g. a routing constraint that spans a Python solver, a React Native map component, and a TypeScript cost router) that ripgrep from a cold start will miss.

Known limitation: conjunction queries ("X and Y edge case") return split results rather than the junction. For those, run two separate searches and intersect manually.

Index: `~/.context/mcp-codebase-snapshot.json` · Milvus collection: `code_chunks_b722dfab` · 553 files · 7 570 chunks · last indexed 2026-04-25.

## Stack

React Native (Expo) mobile app · FastAPI Python backend · WatermelonDB offline sync · Valhalla + OSRM routing · PostGIS CPP/MC-CARP solver · Firebase Auth + App Check · Zilliz/Milvus semantic index.
