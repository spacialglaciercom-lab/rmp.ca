const fs = require("fs");
let c = fs.readFileSync("app/point-detail.tsx", "utf8");
const nl = c.includes("\r\n") ? "\r\n" : "\n";

// 1. Add StreetViewPreview import after MapillaryViewer import
c = c.replace(
  'import { MapillaryViewer } from "@/components/MapillaryViewer";',
  'import { MapillaryViewer } from "@/components/MapillaryViewer";' +
    nl +
    'import { StreetViewPreview } from "@/components/StreetViewPreview";',
);

// 2. Add googleStreetViewVisible state after streetViewVisible state
c = c.replace(
  "const [streetViewVisible, setStreetViewVisible] = useState(false);",
  "const [streetViewVisible, setStreetViewVisible] = useState(false);" +
    nl +
    "  const [googleStreetViewVisible, setGoogleStreetViewVisible] = useState(false);",
);

// 3. Rename "Street View" button label to "Mapillary View"
c = c.replace(
  "              Street View\n            </Text>",
  "              Mapillary View\n            </Text>",
);
c = c.replace(
  "              Street View\r\n            </Text>",
  "              Mapillary View\r\n            </Text>",
);

// 4. Insert Google Street View button after the Mapillary View button (before "Contribute images")
const contributeAnchor = [
  "          <TouchableOpacity",
  "            onPress={() => {",
  "              hapticImpact();",
  "              openMapillaryCapture();",
  "            }}",
].join(nl);

const googleSVButton = [
  "          <TouchableOpacity",
  "            onPress={() => {",
  "              hapticImpact();",
  "              setGoogleStreetViewVisible(true);",
  "            }}",
  '            style={{ backgroundColor: "#4285F4" }}',
  '            className="py-4 rounded-xl items-center active:opacity-70"',
  "          >",
  '            <Text className="text-white text-base font-semibold">',
  "              Street View",
  "            </Text>",
  "          </TouchableOpacity>",
  "",
].join(nl);

if (c.includes(contributeAnchor)) {
  c = c.replace(contributeAnchor, googleSVButton + contributeAnchor);
  console.log("google sv button inserted");
} else {
  console.log("contributeAnchor not found");
}

// 5. Add StreetViewPreview component before closing ScreenContainer
const mapillaryViewer =
  "<MapillaryViewer" +
  nl +
  "        latitude={point.latitude}" +
  nl +
  "        longitude={point.longitude}" +
  nl +
  "        isVisible={streetViewVisible}" +
  nl +
  "        onClose={() => setStreetViewVisible(false)}" +
  nl +
  "      />";

const googleSVComponent = [
  "",
  "      <StreetViewPreview",
  "        points={[{ lat: point.latitude, lon: point.longitude }]}",
  "        isVisible={googleStreetViewVisible}",
  "        onClose={() => setGoogleStreetViewVisible(false)}",
  '        trackName={point.address ?? "Stop"}',
  "      />",
].join(nl);

if (c.includes(mapillaryViewer)) {
  c = c.replace(mapillaryViewer, mapillaryViewer + googleSVComponent);
  console.log("google sv component inserted");
} else {
  console.log("mapillaryViewer anchor not found");
}

fs.writeFileSync("app/point-detail.tsx", c, "utf8");
console.log("done");
