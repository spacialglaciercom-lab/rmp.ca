const fs = require('fs');
let c = fs.readFileSync('app/point-detail.tsx', 'utf8');

// 1. Add Image import to react-native
c = c.replace('  Alert,\r\n  Linking,\r\n} from "react-native";', '  Alert,\r\n  Linking,\r\n  Image,\r\n} from "react-native";');
if (!c.includes('  Image,')) { console.error('FAIL: Image import'); process.exit(1); }

// 2. Add expo-image-picker import
c = c.replace('import { openMapillaryCapture } from "@/lib/mapillary";', 'import { openMapillaryCapture } from "@/lib/mapillary";\r\nimport * as ImagePicker from "expo-image-picker";');
if (!c.includes('expo-image-picker')) { console.error('FAIL: ImagePicker import'); process.exit(1); }

// 3. Add photoUri state
c = c.replace(
  '  const [googleStreetViewVisible, setGoogleStreetViewVisible] = useState(false);',
  '  const [googleStreetViewVisible, setGoogleStreetViewVisible] = useState(false);\r\n  const [photoUri, setPhotoUri] = useState<string | null>(null);'
);
if (!c.includes('photoUri')) { console.error('FAIL: photoUri state'); process.exit(1); }

// 4. Load photoUri when loading point
c = c.replace(
  'setNotes(foundPoint.notes || "");',
  'setNotes(foundPoint.notes || "");\r\n      setPhotoUri(foundPoint.photoUri || null);'
);

// 5. Add handleTakePhoto before handleSaveNotes
c = c.replace(
  '\r\n  const handleSaveNotes = async () => {',
  '\r\n\r\n  const handleTakePhoto = async () => {\r\n    if (!point) return;\r\n    hapticImpact();\r\n    Alert.alert(\r\n      "Add Photo",\r\n      "Choose an option",\r\n      [\r\n        {\r\n          text: "Take Photo",\r\n          onPress: async () => {\r\n            const perm = await ImagePicker.requestCameraPermissionsAsync();\r\n            if (!perm.granted) {\r\n              Alert.alert("Permission required", "Camera access is needed to take photos.");\r\n              return;\r\n            }\r\n            const result = await ImagePicker.launchCameraAsync({\r\n              mediaTypes: ["images"],\r\n              quality: 0.8,\r\n              allowsEditing: false,\r\n            });\r\n            if (!result.canceled && result.assets.length > 0) {\r\n              const uri = result.assets[0].uri;\r\n              setPhotoUri(uri);\r\n              const route = await storage.loadRoute();\r\n              if (route) {\r\n                await storage.updateCollectionPoint(route.id, point.id, { photoUri: uri });\r\n              }\r\n            }\r\n          },\r\n        },\r\n        {\r\n          text: "Choose from Library",\r\n          onPress: async () => {\r\n            const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();\r\n            if (!perm.granted) {\r\n              Alert.alert("Permission required", "Photo library access is needed.");\r\n              return;\r\n            }\r\n            const result = await ImagePicker.launchImageLibraryAsync({\r\n              mediaTypes: ["images"],\r\n              quality: 0.8,\r\n              allowsEditing: false,\r\n            });\r\n            if (!result.canceled && result.assets.length > 0) {\r\n              const uri = result.assets[0].uri;\r\n              setPhotoUri(uri);\r\n              const route = await storage.loadRoute();\r\n              if (route) {\r\n                await storage.updateCollectionPoint(route.id, point.id, { photoUri: uri });\r\n              }\r\n            }\r\n          },\r\n        },\r\n        { text: "Cancel", style: "cancel" },\r\n      ]\r\n    );\r\n  };\r\n\r\n  const handleSaveNotes = async () => {'
);
if (!c.includes('handleTakePhoto')) { console.error('FAIL: handleTakePhoto'); process.exit(1); }

// 6. Add Photo section card before Notes Section in render
c = c.replace(
  '        {/* Notes Section */}',
  '        {/* Photo Section */}\r\n        <View\r\n          className="bg-surface rounded-2xl p-5 mb-4"\r\n          style={{ backgroundColor: colors.surface }}\r\n        >\r\n          <View className="flex-row items-center justify-between mb-3">\r\n            <Text className="text-lg font-semibold text-foreground">Photo</Text>\r\n            <TouchableOpacity onPress={handleTakePhoto} className="active:opacity-70">\r\n              <Text className="text-primary font-medium">\r\n                {photoUri ? "Retake / Change" : "Add Photo"}\r\n              </Text>\r\n            </TouchableOpacity>\r\n          </View>\r\n          {photoUri ? (\r\n            <Image\r\n              source={{ uri: photoUri }}\r\n              style={{ width: "100%", height: 200, borderRadius: 10 }}\r\n              resizeMode="cover"\r\n            />\r\n          ) : (\r\n            <Text className="text-base text-muted">No photo added yet</Text>\r\n          )}\r\n        </View>\r\n\r\n        {/* Notes Section */}'
);
if (!c.includes('Photo Section')) { console.error('FAIL: Photo Section'); process.exit(1); }

fs.writeFileSync('app/point-detail.tsx', c, 'utf8');
console.log('done');
