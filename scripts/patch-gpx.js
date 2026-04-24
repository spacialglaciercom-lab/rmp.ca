const fs = require("fs");
let c = fs.readFileSync("components/VRPPlanner.tsx", "utf8");
const nl = c.includes("\r\n") ? "\r\n" : "\n";

// ── GPX helper ──────────────────────────────────────────────────────────────
const gpxFunctions = `
  const buildGpxForRoute = (routeStops: VRPStop[], routeNum: number, date: string): string => {
    const wpts = routeStops
      .map((s, i) => {
        const name = s.label ? s.label.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") : \`Stop \${i + 1}\`;
        return \`  <wpt lat="\${s.lat.toFixed(6)}" lon="\${s.lon.toFixed(6)}"><name>\${name}</name></wpt>\`;
      })
      .join(nl);
    const trkpts = routeStops
      .map((s) => \`      <trkpt lat="\${s.lat.toFixed(6)}" lon="\${s.lon.toFixed(6)}"/>\`)
      .join(nl);
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx version="1.1" creator="RMP VRP Planner" xmlns="http://www.topografix.com/GPX/1/1">',
      \`  <metadata><name>Vehicle \${routeNum} – \${date}</name></metadata>\`,
      wpts,
      \`  <trk><name>Vehicle \${routeNum}</name><trkseg>\`,
      trkpts,
      '  </trkseg></trk>',
      '</gpx>',
    ].join(nl);
  };

  const handleExportGpx = async () => {
    if (!result?.stops?.length) return;
    hapticImpact();
    const date = new Date().toISOString().slice(0, 10);
    const routes: VRPStop[][] = result.routes && result.routes.length > 1 ? result.routes : [result.stops];

    const allWpts = result.stops
      .map((s, i) => {
        const name = (s.label ?? \`Stop \${i + 1}\`).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        return \`  <wpt lat="\${s.lat.toFixed(6)}" lon="\${s.lon.toFixed(6)}"><name>\${name}</name></wpt>\`;
      })
      .join(nl);

    const tracks = routes
      .map((routeStops, ri) => {
        const trkpts = routeStops
          .map((s) => \`      <trkpt lat="\${s.lat.toFixed(6)}" lon="\${s.lon.toFixed(6)}"/>\`)
          .join(nl);
        return [\`  <trk><name>Vehicle \${ri + 1}</name><trkseg>\`, trkpts, '  </trkseg></trk>'].join(nl);
      })
      .join(nl);

    const gpx = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx version="1.1" creator="RMP VRP Planner" xmlns="http://www.topografix.com/GPX/1/1">',
      \`  <metadata><name>VRP Routes – \${date}</name></metadata>\`,
      allWpts,
      tracks,
      '</gpx>',
    ].join(nl);

    const fileName = \`vrp_routes_\${date}.gpx\`;
    try {
      if (Platform.OS === "web") {
        const blob = new Blob([gpx], { type: "application/gpx+xml" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = fileName;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
        Alert.alert("Exported", \`GPX saved as \${fileName}\`);
      } else {
        const FileSystem = await import("expo-file-system/legacy");
        const Sharing = (await import("expo-sharing")) as { isAvailableAsync: () => Promise<boolean>; shareAsync: (uri: string, opts?: { mimeType?: string; dialogTitle?: string }) => Promise<void> };
        const fileUri = \`\${FileSystem.cacheDirectory ?? ""}\${fileName}\`;
        await FileSystem.writeAsStringAsync(fileUri, gpx, { encoding: FileSystem.EncodingType.UTF8 });
        const isAvailable = await Sharing.isAvailableAsync();
        if (isAvailable) {
          await Sharing.shareAsync(fileUri, { mimeType: "application/gpx+xml", dialogTitle: "Export VRP routes (GPX)" });
        } else {
          Alert.alert("Saved", \`GPX saved to \${fileUri}\`);
        }
      }
    } catch (e) {
      console.error(e);
      Alert.alert("Export failed", "Could not export GPX. Please try again.");
    }
  };

  const handleExportGpxPerVehicle = async () => {
    if (!result?.stops?.length) return;
    hapticImpact();
    const date = new Date().toISOString().slice(0, 10);
    const routes: VRPStop[][] = result.routes && result.routes.length > 1 ? result.routes : [result.stops];

    if (routes.length === 1) {
      Alert.alert("Single route", "Only one vehicle – exporting as single GPX file.");
      return handleExportGpx();
    }

    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      routes.forEach((routeStops, ri) => {
        const gpx = buildGpxForRoute(routeStops, ri + 1, date);
        zip.file(\`vehicle_\${ri + 1}.gpx\`, gpx);
      });
      const zipBlob = await zip.generateAsync({ type: Platform.OS === "web" ? "blob" : "base64" });
      const fileName = \`vrp_routes_per_vehicle_\${date}.zip\`;

      if (Platform.OS === "web") {
        const url = URL.createObjectURL(zipBlob as Blob);
        const a = document.createElement("a");
        a.href = url; a.download = fileName;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
        Alert.alert("Exported", \`\${routes.length} GPX files saved in \${fileName}\`);
      } else {
        const FileSystem = await import("expo-file-system/legacy");
        const Sharing = (await import("expo-sharing")) as { isAvailableAsync: () => Promise<boolean>; shareAsync: (uri: string, opts?: { mimeType?: string; dialogTitle?: string }) => Promise<void> };
        const fileUri = \`\${FileSystem.cacheDirectory ?? ""}\${fileName}\`;
        await FileSystem.writeAsStringAsync(fileUri, zipBlob as string, { encoding: FileSystem.EncodingType.Base64 });
        const isAvailable = await Sharing.isAvailableAsync();
        if (isAvailable) {
          await Sharing.shareAsync(fileUri, { mimeType: "application/zip", dialogTitle: "Export GPX per vehicle (ZIP)" });
        } else {
          Alert.alert("Saved", \`ZIP saved to \${fileUri}\`);
        }
      }
    } catch (e) {
      console.error(e);
      Alert.alert("Export failed", "Could not export GPX files. Please try again.");
    }
  };
`;

// Insert the GPX functions before handleExportCsv
const anchor = "  const handleExportCsv = async () => {";
c = c.replace(anchor, gpxFunctions + nl + anchor);

// ── UI buttons ──────────────────────────────────────────────────────────────
const csvButton = `              <TouchableOpacity
                style={[styles.previewButton, styles.previewButtonSecondary, { borderColor: colors.border }]}
                onPress={handleExportCsv}
                activeOpacity={0.8}
              >
                <Ionicons name="document-text-outline" size={18} color={colors.foreground} style={{ marginRight: 6 }} />
                <Text style={[styles.previewButtonTextSecondary, { color: colors.foreground }]}>Export CSV</Text>
              </TouchableOpacity>`;

const csvButtonWithGpx =
  csvButton +
  nl +
  `              <TouchableOpacity
                style={[styles.previewButton, styles.previewButtonSecondary, { borderColor: colors.border }]}
                onPress={handleExportGpx}
                activeOpacity={0.8}
              >
                <Ionicons name="navigate-outline" size={18} color={colors.foreground} style={{ marginRight: 6 }} />
                <Text style={[styles.previewButtonTextSecondary, { color: colors.foreground }]}>Export GPX</Text>
              </TouchableOpacity>` +
  nl +
  `              {result?.routes && result.routes.length > 1 && (
                <TouchableOpacity
                  style={[styles.previewButton, styles.previewButtonSecondary, { borderColor: colors.border }]}
                  onPress={handleExportGpxPerVehicle}
                  activeOpacity={0.8}
                >
                  <Ionicons name="archive-outline" size={18} color={colors.foreground} style={{ marginRight: 6 }} />
                  <Text style={[styles.previewButtonTextSecondary, { color: colors.foreground }]}>GPX per vehicle</Text>
                </TouchableOpacity>
              )}`;

c = c.replace(csvButton, csvButtonWithGpx);

fs.writeFileSync("components/VRPPlanner.tsx", c, "utf8");
console.log("done");
