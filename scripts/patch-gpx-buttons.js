const fs = require('fs');
let c = fs.readFileSync('components/VRPPlanner.tsx', 'utf8');

const csvButtonAnchor = 'onPress={handleExportCsv}\r\n                activeOpacity={0.8}\r\n              >\r\n                <Ionicons name="document-text-outline" size={18} color={colors.foreground} style={{ marginRight: 6 }} />\r\n                <Text style={[styles.previewButtonTextSecondary, { color: colors.foreground }]}>Export CSV</Text>\r\n              </TouchableOpacity>';

const gpxButtons = '\r\n              <TouchableOpacity\r\n                style={[styles.previewButton, styles.previewButtonSecondary, { borderColor: colors.border }]}\r\n                onPress={handleExportGpx}\r\n                activeOpacity={0.8}\r\n              >\r\n                <Ionicons name="navigate-outline" size={18} color={colors.foreground} style={{ marginRight: 6 }} />\r\n                <Text style={[styles.previewButtonTextSecondary, { color: colors.foreground }]}>Export GPX</Text>\r\n              </TouchableOpacity>\r\n              {result?.routes && result.routes.length > 1 && (\r\n                <TouchableOpacity\r\n                  style={[styles.previewButton, styles.previewButtonSecondary, { borderColor: colors.border }]}\r\n                  onPress={handleExportGpxPerVehicle}\r\n                  activeOpacity={0.8}\r\n                >\r\n                  <Ionicons name="archive-outline" size={18} color={colors.foreground} style={{ marginRight: 6 }} />\r\n                  <Text style={[styles.previewButtonTextSecondary, { color: colors.foreground }]}>GPX per vehicle</Text>\r\n                </TouchableOpacity>\r\n              )}';

if (c.includes(csvButtonAnchor)) {
  c = c.replace(csvButtonAnchor, csvButtonAnchor + gpxButtons);
  fs.writeFileSync('components/VRPPlanner.tsx', c, 'utf8');
  console.log('done');
} else {
  console.log('anchor not found');
}
