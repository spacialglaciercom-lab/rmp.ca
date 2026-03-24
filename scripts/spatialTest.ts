import { SpatialQueryService } from "../services/spatialQueryService";

async function runSpatialTest() {
  const spatialQueryService = new SpatialQueryService();
  const result = await spatialQueryService.healthCheck();
  console.log("Spatial service health query result:", result);
}

runSpatialTest().catch((error) => {
  console.error("Spatial test failed:", error);
  process.exitCode = 1;
});
