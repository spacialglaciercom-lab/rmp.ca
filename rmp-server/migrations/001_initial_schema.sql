-- RMP Initial Schema
-- Mirrors drizzle/schema.ts exactly. No schema changes from the Node.js version.

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS postgis;

-- Enums
DO $$ BEGIN
    CREATE TYPE role AS ENUM ('user', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE org_tier AS ENUM ('trial', 'standard', 'enterprise');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE permission_request_status AS ENUM ('pending', 'approved', 'denied');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Organizations
CREATE TABLE IF NOT EXISTS organizations (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    city TEXT,
    tier org_tier NOT NULL DEFAULT 'trial',
    "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Users
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    "openId" VARCHAR(64) NOT NULL UNIQUE,
    name TEXT,
    email VARCHAR(320),
    "loginMethod" VARCHAR(64),
    role role NOT NULL DEFAULT 'user',
    "orgId" INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
    "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
    "lastSignedIn" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- RBAC: Roles
CREATE TABLE IF NOT EXISTS roles (
    id SERIAL PRIMARY KEY,
    "orgId" INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT FALSE,
    "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- RBAC: Role permissions
CREATE TABLE IF NOT EXISTS role_permissions (
    "roleId" INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    "permissionKey" TEXT NOT NULL,
    PRIMARY KEY ("roleId", "permissionKey")
);

-- RBAC: User roles
CREATE TABLE IF NOT EXISTS user_roles (
    "userId" INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    "roleId" INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    "orgId" INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    PRIMARY KEY ("userId", "roleId", "orgId")
);

-- RBAC: Permission requests
CREATE TABLE IF NOT EXISTS permission_requests (
    id SERIAL PRIMARY KEY,
    "orgId" INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    "requesterId" INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    "requestedPermissions" TEXT[] NOT NULL,
    status permission_request_status NOT NULL DEFAULT 'pending',
    "approvedPermissions" TEXT[],
    token VARCHAR(128) NOT NULL UNIQUE,
    "expiresAt" TIMESTAMP NOT NULL,
    "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
    "resolvedAt" TIMESTAMP,
    "resolvedBy" INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- GIS: Collection points
CREATE TABLE IF NOT EXISTS collection_points (
    id SERIAL PRIMARY KEY,
    address TEXT,
    location geography(Point, 4326),
    is_collected BOOLEAN DEFAULT FALSE,
    qr_code_token TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- GIS: Optimized routes
CREATE TABLE IF NOT EXISTS optimized_routes (
    id SERIAL PRIMARY KEY,
    route_name TEXT,
    path geography(LineString, 4326),
    total_distance_meters DOUBLE PRECISION,
    created_at TIMESTAMP DEFAULT NOW()
);

-- DEM elevation
CREATE TABLE IF NOT EXISTS dem_elevation (
    rid SERIAL PRIMARY KEY,
    rast raster,
    source_file TEXT,
    imported_at TIMESTAMP DEFAULT NOW()
);

-- Offline Sync: Waste points
CREATE TABLE IF NOT EXISTS waste_points (
    id TEXT PRIMARY KEY,
    org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    external_id TEXT,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    type VARCHAR(50) NOT NULL,
    condition VARCHAR(50),
    address TEXT,
    location_name TEXT,
    notes TEXT,
    photo_uri TEXT,
    last_collection_date TIMESTAMP,
    collection_count INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    deleted_at TIMESTAMP,
    synced_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Offline Sync: Routes
CREATE TABLE IF NOT EXISTS routes (
    id TEXT PRIMARY KEY,
    org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    external_id TEXT,
    name TEXT,
    date TIMESTAMP,
    driver_id INTEGER,
    vehicle_id TEXT,
    status VARCHAR(50) DEFAULT 'pending',
    total_points INTEGER DEFAULT 0,
    completed_points INTEGER DEFAULT 0,
    estimated_duration_minutes INTEGER,
    actual_duration_minutes INTEGER,
    total_distance_meters DOUBLE PRECISION,
    route_source VARCHAR(50),
    deleted_at TIMESTAMP,
    synced_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Offline Sync: Route stops
CREATE TABLE IF NOT EXISTS route_stops (
    id TEXT PRIMARY KEY,
    route_id TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    waste_point_id TEXT REFERENCES waste_points(id) ON DELETE SET NULL,
    sequence INTEGER NOT NULL,
    address TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    collection_type VARCHAR(50),
    status VARCHAR(50) DEFAULT 'pending',
    special_instructions TEXT,
    notes TEXT,
    photo_uri TEXT,
    completed_at TIMESTAMP,
    skipped_reason TEXT,
    deleted_at TIMESTAMP,
    synced_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Offline Sync: Zones
CREATE TABLE IF NOT EXISTS zones (
    id TEXT PRIMARY KEY,
    org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    color VARCHAR(7),
    boundary geography(Polygon, 4326),
    is_active BOOLEAN DEFAULT TRUE,
    deleted_at TIMESTAMP,
    synced_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Offline Sync: Favorites
CREATE TABLE IF NOT EXISTS favorites (
    id TEXT PRIMARY KEY,
    org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    address TEXT,
    category VARCHAR(50),
    notes TEXT,
    photo_uri TEXT,
    deleted_at TIMESTAMP,
    synced_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Offline Sync: Sync status
CREATE TABLE IF NOT EXISTS sync_status (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    table_name VARCHAR(100) NOT NULL,
    last_sync_token TEXT,
    last_sync_at TIMESTAMP,
    pending_count INTEGER DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, table_name)
);

-- Spatial indexes for PostGIS columns
CREATE INDEX IF NOT EXISTS idx_collection_points_location ON collection_points USING GIST (location);
CREATE INDEX IF NOT EXISTS idx_optimized_routes_path ON optimized_routes USING GIST (path);
CREATE INDEX IF NOT EXISTS idx_zones_boundary ON zones USING GIST (boundary);
CREATE INDEX IF NOT EXISTS idx_dem_elevation_rast ON dem_elevation USING GIST (ST_ConvexHull(rast));
