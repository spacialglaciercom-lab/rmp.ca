# TrashRoute API – used by Cloud Build (default). See Dockerfile.api for manual deploy.
# Requires ai@6 (see pnpm-lock.yaml) for Vercel AI Gateway v3 models.
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

# Copy package files and patches (lockfile references patchedDependencies)
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches

# Install dependencies (include dev for build). Skip postinstall: patch scripts are for mobile/React Native, not the API.
RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy source and build the API server bundle (not Expo web)
COPY . .
RUN pnpm run build:server

# Production image
FROM node:20-alpine

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
# Production install only (skip postinstall – not needed for API runtime)
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
EXPOSE 3000

# Hosts like Railway/Render set PORT
CMD ["node", "dist/index.js"]
