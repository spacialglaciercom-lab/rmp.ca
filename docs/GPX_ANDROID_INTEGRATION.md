# GPX Export and Android Integration

## Summary

This document describes the implementation of GPX export functionality for routing solutions and the Android integration architecture.

## Backend Implementation

### GPX Export Features

1. **CVRP Solutions**: Export Clarke-Wright and 2-Opt solutions to GPX
2. **CPP Solutions**: Export Chinese Postman Problem solutions to GPX
3. **VRP Solutions**: Export Vehicle Routing Problem solutions to GPX

### Implementation Files

- `backend/app/cvrp_gpx.py` - CVRP to GPX conversion
- `backend/app/optimize.py` - CPP to GPX conversion (enhanced)
- `backend/app/vrp.py` - VRP to GPX conversion (existing)
- `benchmark.py` - Enhanced with GPX export capability

### API Endpoints

All major endpoints support GPX export via Accept header:
- POST /api/optimize - Add `Accept: application/gpx+xml` for GPX response
- POST /api/vrp/solve - Add `Accept: application/gpx+xml` for GPX response

### Benchmark Script

Run with GPX export:
```bash
python benchmark.py --gpx --gpx-dir ./exports ./data
```

## Android Integration

### Architecture

MVVM pattern with:
- RouteUiState - Parcelable UI state
- RouteViewModel - Data loading and state management
- RouteRepository - Data source abstraction
- RouteMapScreen - Jetpack Compose UI

### Key Features

- Single source of truth for route data
- Support for both API (JSON) and GPX file sources
- Survives process death with SavedStateHandle
- Reactive UI updates with StateFlow

### Implementation Steps

1. Copy mobile-scaffold package into Android app
2. Add required dependencies
3. Implement RouteRepository with Retrofit and XML parser
4. Add GPX file intent handling in AndroidManifest.xml
5. Create Activity to handle GPX file intents

### GPX File Handling

Supports opening GPX files from file managers and share intents through proper intent filters and MIME type handling.