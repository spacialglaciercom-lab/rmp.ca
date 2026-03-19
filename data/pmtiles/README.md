# PMTiles served at `/tiles`

Place your `.pmtiles` files here. The API serves them at:

- **Base URL:** `http://localhost:3000/tiles/` (or your server URL/port)
- **Example:** For `planet_-73.91,45.38_-73.241,45.723_residential-tertiary-unclassified-secondary.pmtiles` use:
  - **PMTiles URL:** `http://localhost:3000/tiles/planet_-73.91,45.38_-73.241,45.723_residential-tertiary-unclassified-secondary.pmtiles`
  - If the server runs on another port (e.g. 8082), use that port in the URL.

In your map style editor (Sources → Add New Source):

- **Source ID:** e.g. `overture-roads` or `planet-montreal-roads`
- **Source Type:** Vector (PMTiles)
- **PMTiles URL:** `http://localhost:3000/tiles/planet_-73.91,45.38_-73.241,45.723_residential-tertiary-unclassified-secondary.pmtiles`

Then click **Add Source**.
