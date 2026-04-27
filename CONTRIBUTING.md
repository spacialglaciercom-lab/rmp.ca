# Contributing to RouteMaster Pro (rmp.ca)

First off — **thank you** for your interest in contributing! 🎉

RouteMaster Pro is a complex, cross-platform system for offline-first route optimization. Whether you're fixing a typo, improving documentation, or tackling a spatial algorithm, every contribution helps.

---

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Commit Messages](#commit-messages)
- [Pull Request Process](#pull-request-process)
- [Reporting Issues](#reporting-issues)
- [Contributor License Agreement (CLA)](#contributor-license-agreement-cla)
- [Good First Issues](#good-first-issues)

---

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md).
By participating, you agree to uphold this standard. Please be respectful, inclusive, and constructive.

---

## Getting Started

### Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| **Node.js** | ≥ 18 | Backend & mobile tooling |
| **pnpm** | ≥ 8 | Package manager |
| **Expo CLI** | Latest | React Native development |
| **PostgreSQL** | ≥ 14 | Database with PostGIS extension |
| **PostGIS** | ≥ 3.3 | Geospatial queries |
| **Python** | ≥ 3.10 | Optimizer service |
| **Docker** (optional) | Latest | Containerized services |

### Fork & Clone

```bash
# Fork the repo on GitHub, then:
git clone https://github.com/YOUR_USERNAME/rmp.ca.git
cd rmp.ca
pnpm install
```

### Environment Setup

```bash
# Copy the example env files and fill in your values:
cp .env.example .env
cp .env.server.example .env.server
cp .env.r2.example .env.r2

# Set up the database (PostgreSQL + PostGIS):
pnpm db:push      # Run migrations via Drizzle
pnpm db:seed      # Optional: seed sample data
```

### Start Development

```bash
# Start the backend (tRPC API):
pnpm dev:server

# Start the mobile app (Expo):
pnpm start

# Start the Python optimizer (optional):
cd services/optimizer && python -m optimizer
```

---

## Project Structure

Here's a simplified layout to help you orient yourself:

```
rmp.ca/
├── app/                    # Expo Router screens & layouts
├── backend/                # Node.js tRPC API + Drizzle ORM
├── components/             # Shared React Native UI components
├── drizzle/                # Database schema & migrations
├── lib/                    # Shared utilities & helpers
├── server/                 # Express/Hono server entry
├── services/               # Microservices (optimizer, etc.)
├── shared/                 # Cross-platform shared code
├── shared-logic/           # Core spatial/routing algorithms
├── stores/                 # State management (Zustand)
├── scripts/                # Build, deploy & utility scripts
├── extract/                # Overture Maps extraction tools
├── tests/ & e2e/           # Test suites
├── docs/                   # Extended documentation
└── configs/                # nginx, Docker, etc.
```

---

## Development Setup

### Branch Naming Convention

We use descriptive branch names to keep things organized:

| Type | Format | Example |
|------|--------|---------|
| Feature | `feature/description` | `feature/battery-status-indicator` |
| Bug fix | `fix/description` | `fix/ios-offline-sync-crash` |
| Docs | `docs/description` | `docs/api-endpoint-reference` |
| Refactor | `refactor/description` | `refactor/sync-queue-retry-logic` |
| Chore | `chore/description` | `chore/update-deps-q1-2026` |

---

## Making Changes

1. **Create a branch** off `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** — keep them focused and atomic (one concern per PR).

3. **Test your changes**:
   ```bash
   pnpm test              # Unit tests
   pnpm test:e2e          # End-to-end tests
   pnpm lint              # ESLint
   pnpm type-check        # TypeScript validation
   ```

4. **Commit with a clear message** (see [Commit Messages](#commit-messages) below).

5. **Push and open a Pull Request**:
   ```bash
   git push origin feature/your-feature-name
   ```

---

## Commit Messages

We follow **Conventional Commits** for consistency:

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### Types

| Type | Purpose |
|------|---------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation changes |
| `style` | Formatting, no code change |
| `refactor` | Code restructuring (no feature/fix) |
| `perf` | Performance improvement |
| `test` | Adding or updating tests |
| `chore` | Build, deps, tooling changes |
| `ci` | CI/CD configuration |

### Examples

```
feat(sync): add retry backoff for offline queue
fix(ios): resolve WatermelonDB schema migration crash
docs(api): document tRPC spatial endpoints
refactor(solver): extract 2-opt into shared module
```

---

## Pull Request Process

1. **Title** should clearly describe the change (follow commit format).
2. **Description** should explain **why** the change was made, not just what.
3. **Screenshots** are required for any UI changes.
4. **Tests** should cover new logic. Existing tests must still pass.
5. **Keep it small** — if a PR is doing too much, split it up.
6. **One reviewer** approval is required to merge.
7. **Squash merge** is the default to keep history clean.

### PR Template

```markdown
## Summary
Brief description of what this PR does and why.

## Changes
- Change 1
- Change 2

## Testing
How was this tested?

## Screenshots (if applicable)
Before / After

## Checklist
- [ ] Tests pass
- [ ] Lint passes
- [ ] No secrets or credentials exposed
- [ ] Documentation updated (if needed)
```

---

## Reporting Issues

Found a bug or have a suggestion? We'd love to hear from you.

### Bug Reports

Please include:

1. **Environment** — OS, app version, Node.js version, device (iOS/Android)
2. **Steps to reproduce** — what you did, what happened, what you expected
3. **Logs** — relevant error messages or console output
4. **Screenshots** — if applicable

### Feature Requests

Tell us:

1. **The problem** you're trying to solve (not just the solution)
2. **Any workarounds** you've found
3. **Why this matters** — who benefits and how often

Open an issue at: https://github.com/spacialglaciercom-lab/rmp.ca/issues

---

## Contributor License Agreement (CLA)

> ⚠️ **Important:** RouteMaster Pro is released under a **proprietary license**.
> All contributors must sign a CLA before their pull request can be merged.

This ensures that:
- The project maintainer retains ownership of all contributions
- Contributions are properly licensed back to the project
- There are no future licensing conflicts

You will be prompted to sign the CLA when you open your first pull request. It's a one-time process and takes about 2 minutes.

---

## Good First Issues

Looking for somewhere to start? Check out issues labeled [`good first issue`](https://github.com/spacialglaciercom-lab/rmp.ca/labels/good%20first%20issue) for beginner-friendly tasks.

### Areas That Need Help

| Area | Description | Difficulty |
|------|-------------|------------|
| 📱 **UI/UX** | Polish screens, fix layout bugs, improve accessibility | Beginner |
| 📖 **Documentation** | Improve README, add inline docs, create tutorials | Beginner |
| 🧪 **Testing** | Add unit tests for untested modules, increase coverage | Beginner |
| 🌐 **i18n** | Add translations, fix localization edge cases | Beginner |
| 🗺️ **Spatial** | Optimize PostGIS queries, improve sync performance | Intermediate |
| 📡 **Offline** | Improve conflict resolution, queue reliability | Intermediate |
| 🧮 **Routing** | Enhance solver algorithms, add VRP support | Advanced |

---

## Questions?

- Open a [Discussion](https://github.com/spacialglaciercom-lab/rmp.ca/discussions)
- Email us at **contact@rmp.ca**
- Visit [rmp.ca](https://rmp.ca)

---

*Thanks for helping make RouteMaster Pro better!* 🚗🗺️
