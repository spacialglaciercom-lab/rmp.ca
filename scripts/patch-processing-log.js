const fs = require('fs');
let c = fs.readFileSync('components/processing-log.tsx', 'utf8');
const nl = c.includes('\r\n') ? '\r\n' : '\n';

// 1. Add Platform and Alert to imports
c = c.replace(
  'import { View, Text, ScrollView, TouchableOpacity } from "react-native";',
  'import { View, Text, ScrollView, TouchableOpacity, Platform, Alert } from "react-native";'
);

// 2. Insert handleExportLog before the return statement
const returnAnchor = '  return (' + nl + '    <View' + nl + '      className="bg-surface rounded-2xl p-5 mb-4"';
const exportFn = [
  '  const handleExportLog = async () => {',
  '    if (state.processingLog.length === 0) return;',
  '    hapticImpact();',
  "    const date = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');",
  '    const fileName = `route_log_${date}.json`;',
  '    const payload = JSON.stringify(',
  '      state.processingLog.map((e) => ({',
  '        timestamp: new Date(e.timestamp).toISOString(),',
  '        type: e.type,',
  '        message: e.message,',
  '      })),',
  '      null,',
  '      2',
  '    );',
  '    try {',
  "      if (Platform.OS === 'web') {",
  "        const blob = new Blob([payload], { type: 'application/json' });",
  '        const url = URL.createObjectURL(blob);',
  "        const a = document.createElement('a');",
  '        a.href = url; a.download = fileName;',
  '        document.body.appendChild(a); a.click();',
  '        document.body.removeChild(a); URL.revokeObjectURL(url);',
  '      } else {',
  "        const FileSystem = await import('expo-file-system/legacy');",
  "        const Sharing = (await import('expo-sharing')) as { isAvailableAsync: () => Promise<boolean>; shareAsync: (uri: string, opts?: { mimeType?: string; dialogTitle?: string }) => Promise<void> };",
  '        const fileUri = `${FileSystem.cacheDirectory ?? ""}${fileName}`;',
  '        await FileSystem.writeAsStringAsync(fileUri, payload, { encoding: FileSystem.EncodingType.UTF8 });',
  '        const isAvailable = await Sharing.isAvailableAsync();',
  '        if (isAvailable) {',
  "          await Sharing.shareAsync(fileUri, { mimeType: 'application/json', dialogTitle: 'Export processing log' });",
  '        } else {',
  "          Alert.alert('Saved', `Log saved to ${fileUri}`);",
  '        }',
  '      }',
  '    } catch (e) {',
  '      console.error(e);',
  "      Alert.alert('Export failed', 'Could not export log. Please try again.');",
  '    }',
  '  };',
  '',
].join(nl);

if (c.includes(returnAnchor)) {
  c = c.replace(returnAnchor, exportFn + returnAnchor);
  console.log('exportFn inserted');
} else {
  console.log('returnAnchor not found, trying fallback');
  // fallback: insert before `return (`
  const fallback = '  return (';
  const idx = c.lastIndexOf(fallback);
  if (idx >= 0) {
    c = c.slice(0, idx) + exportFn + c.slice(idx);
    console.log('exportFn inserted via fallback');
  }
}

// 3. Replace the Clear-only button row with Export + Clear
// Find the exact button block
const idx = c.indexOf('onPress={handleClearLog}');
if (idx >= 0) {
  // Find the surrounding TouchableOpacity block
  const blockStart = c.lastIndexOf('<TouchableOpacity', idx);
  const blockEnd = c.indexOf('</TouchableOpacity>', idx) + '</TouchableOpacity>'.length;
  // Find the wrapping conditional
  const condStart = c.lastIndexOf('{state.processingLog.length > 0 && (', blockStart);
  const condEnd = c.indexOf(')}', blockEnd) + 2;
  if (condStart >= 0 && condEnd > condStart) {
    const newButtons = [
      '        {state.processingLog.length > 0 && (',
      '          <View style={{ flexDirection: "row", gap: 16 }}>',
      '            <TouchableOpacity onPress={handleExportLog} className="active:opacity-70">',
      '              <Text className="text-sm text-muted">Export</Text>',
      '            </TouchableOpacity>',
      '            <TouchableOpacity onPress={handleClearLog} className="active:opacity-70">',
      '              <Text className="text-sm text-muted">Clear</Text>',
      '            </TouchableOpacity>',
      '          </View>',
      '        )}',
    ].join(nl);
    c = c.slice(0, condStart) + newButtons + c.slice(condEnd);
    console.log('buttons replaced');
  } else {
    console.log('cond block not found');
  }
} else {
  console.log('handleClearLog onPress not found');
}

fs.writeFileSync('components/processing-log.tsx', c, 'utf8');
console.log('done');
