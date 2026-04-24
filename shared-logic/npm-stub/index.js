"use strict";
// Stub until KMP build is run: ./gradlew :shared-logic:assemble
// Then in package.json use: "shared-logic": "file:./shared-logic/build/js/packages/shared-logic"
function throwNotBuilt() {
  throw new Error("shared-logic not built. Run: ./gradlew :shared-logic:assemble");
}
exports.SharedLogicBridge = {
  solveCvrp: function () {
    throwNotBuilt();
  },
};
