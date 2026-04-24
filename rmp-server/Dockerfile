# Build stage
FROM rust:1.85-alpine AS builder

RUN apk add --no-cache musl-dev pkgconf openssl-dev openssl-libs-static

WORKDIR /app

# Copy manifests first for dependency caching
COPY Cargo.toml Cargo.lock ./
COPY crates/api/Cargo.toml crates/api/Cargo.toml
COPY crates/auth/Cargo.toml crates/auth/Cargo.toml
COPY crates/db/Cargo.toml crates/db/Cargo.toml
COPY crates/handlers/Cargo.toml crates/handlers/Cargo.toml
COPY crates/proxy/Cargo.toml crates/proxy/Cargo.toml
COPY crates/optimizer/Cargo.toml crates/optimizer/Cargo.toml
COPY crates/shared/Cargo.toml crates/shared/Cargo.toml

# Create dummy source files so cargo can resolve the workspace
RUN mkdir -p crates/api/src && echo "fn main() {}" > crates/api/src/main.rs \
    && mkdir -p crates/auth/src && echo "" > crates/auth/src/lib.rs \
    && mkdir -p crates/db/src && echo "" > crates/db/src/lib.rs \
    && mkdir -p crates/handlers/src && echo "" > crates/handlers/src/lib.rs \
    && mkdir -p crates/proxy/src && echo "" > crates/proxy/src/lib.rs \
    && mkdir -p crates/optimizer/src && echo "" > crates/optimizer/src/lib.rs \
    && mkdir -p crates/shared/src && echo "" > crates/shared/src/lib.rs

# Build dependencies only (cached layer)
RUN cargo build --release --bin rmp-server 2>/dev/null || true

# Copy actual source code
COPY crates/ crates/
COPY migrations/ migrations/

# Touch source files to invalidate the cache for the real build
RUN find crates/ -name "*.rs" -exec touch {} +

# Build the actual binary
RUN cargo build --release --bin rmp-server

# Runtime stage
FROM alpine:3.21

RUN apk add --no-cache ca-certificates

WORKDIR /app

COPY --from=builder /app/target/release/rmp-server /app/rmp-server
COPY migrations/ /app/migrations/

ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

CMD ["/app/rmp-server"]
