# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Dependencies:** Updated Node dependencies to latest patch/minor within current semver ranges (e.g. @ai-sdk/openai-compatible, @react-navigation/*, @tanstack/react-query, @trpc/*, axios, firebase, firebase-admin, genkit, mysql2, nativewind, zod, drizzle-kit, esbuild, eslint, prettier, and others). Lock file (pnpm-lock.yaml) updated.
- **Lint / code quality:** Ran `pnpm lint --fix`; fixed ESLint errors: unescaped entities in JSX (react/no-unescaped-entities), component display name (AIChatBubble), conditional hooks in NavigationView (moved useMemo and useMapLayerStore above early return), FileSystem.EncodingType usage in FeedbackSheet (use string `"base64"`), and optional dynamic import path (eslint-disable for leap-extract) in BetaFeaturesSection.
- **Tests:** Updated plugin config test to match current default config (plugin enabled flags); overtureExtractService cache-key tests still fail (reported below).

### Added

- **CHANGELOG.md:** This file with an Unreleased section.

### Removed

- **Dead code (plan scope):** Removed unused imports and variables in map-content, planner-content, and extract-content per DEAD-CODE-REPORT (e.g. unused store selectors, unused lazy component, unused helper references). Left unused exports in services/lib as per plan (reserved for external/future use).

### Security

- **Audit:** `pnpm audit` reported 2 vulnerabilities: 1 moderate (esbuild in transitive path via drizzle-kit; patched in esbuild >=0.25.0), 1 low (@tootallnate/once in genkit/google-cloud deps). Both are in transitive dependencies; no direct action taken this pass.

---

## [1.1.7] - 2026-03-11

### Changed

- Bump patch version to 1.1.7 (package.json, app.json).

---

## [1.1.6] - (previous release)
