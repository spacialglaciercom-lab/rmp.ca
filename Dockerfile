# TrashRoute API – used by Cloud Build (default). See Dockerfile.api for manual deploy.
# Requires ai@6 (see pnpm-lock.yaml) for Vercel AI Gateway v3 models.
# Uses AWS ECR Public Gallery mirror to avoid Docker Hub TLS timeouts behind VPNs.
ARG BASE_IMAGE=public.ecr.aws/docker/library/node:20-alpine
FROM ${BASE_IMAGE} AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

# Copy package files and patches (lockfile references patchedDependencies)
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches

# Stub shared-logic so pnpm install can resolve file:./shared-logic/build/js/packages/shared-logic (Kotlin/JS build not run in Docker; server bundle does not use it).
RUN mkdir -p shared-logic/build/js/packages/shared-logic/kotlin && \
  printf '%s\n' '{"name":"shared-logic","version":"0.0.1","main":"kotlin/rmp-ca-shared-logic.js","description":"KMP shared-logic stub for Docker"}' > shared-logic/build/js/packages/shared-logic/package.json && \
  echo "module.exports = {};" > shared-logic/build/js/packages/shared-logic/kotlin/rmp-ca-shared-logic.js

# Install dependencies (include dev for build). Skip postinstall: patch scripts are for mobile/React Native, not the API.
# Use --no-frozen-lockfile so patchedDependencies hash matches the patch file in this environment (avoids ERR_PNPM_LOCKFILE_CONFIG_MISMATCH).
RUN pnpm install --no-frozen-lockfile --ignore-scripts
# esbuild needs its platform-specific binary; rebuild it for the container arch
RUN pnpm rebuild esbuild

# Copy source and build the API server bundle (not Expo web)
COPY . .
RUN pnpm run build:server

# Production image
FROM ${BASE_IMAGE}

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
# Stub shared-logic so pnpm install can resolve file: dependency (same as builder).
RUN mkdir -p shared-logic/build/js/packages/shared-logic/kotlin && \
  printf '%s\n' '{"name":"shared-logic","version":"0.0.1","main":"kotlin/rmp-ca-shared-logic.js","description":"KMP shared-logic stub for Docker"}' > shared-logic/build/js/packages/shared-logic/package.json && \
  echo "module.exports = {};" > shared-logic/build/js/packages/shared-logic/kotlin/rmp-ca-shared-logic.js
# Production install only (skip postinstall – not needed for API runtime). --no-frozen-lockfile so patchedDependencies hash matches.
RUN pnpm install --no-frozen-lockfile --prod --ignore-scripts

COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
EXPOSE 3000

# Hosts like Railway/Render set PORT
CMD ["node", "dist/index.js"]
