import { DuckDB } from '@duckdb/duckdb-wasm';

export class SpatialQueryService {
  private db: DuckDB;

  constructor() {
    this.db = new DuckDB();
    // Initialize spatial extensions
    this.db.execute('CREATE EXTENSION IF NOT EXISTS postgis');
  }

  async queryIntersections(geometry: string) {
    return this.db.query(
      `SELECT * FROM route_edges
       WHERE ST_Intersects(geom, ST_GeomFromText('${geometry}'))`
    );
  }

  async calculateDistance(pointA: string, pointB: string) {
    return this.db.query(
      `SELECT ST_Distance(
        ST_GeomFromText('${pointA}'),
        ST_GeomFromText('${pointB}')
      )`
    );
  }
}