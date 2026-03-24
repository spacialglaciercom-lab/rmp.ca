export class SpatialQueryService {
  private db: any | null = null;

  constructor() {
    try {
      // Use Node DuckDB bindings in local scripts/tests.
      const duckdb = require("duckdb");
      this.db = new duckdb.Database(":memory:");
    } catch {
      this.db = null;
    }
  }

  private async runQuery(query: string) {
    if (!this.db) {
      throw new Error("duckdb runtime is not available");
    }

    return new Promise<any[]>((resolve, reject) => {
      this.db.all(query, (error: Error | null, rows: any[]) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(rows);
      });
    });
  }

  async healthCheck() {
    return this.runQuery("SELECT 1 AS ok");
  }

  async queryIntersections(geometry: string) {
    return this.runQuery(
      `SELECT * FROM route_edges
       WHERE ST_Intersects(geom, ST_GeomFromText('${geometry}'))`,
    );
  }

  async calculateDistance(pointA: string, pointB: string) {
    return this.runQuery(
      `SELECT ST_Distance(
        ST_GeomFromText('${pointA}'),
        ST_GeomFromText('${pointB}')
      )`,
    );
  }
}
