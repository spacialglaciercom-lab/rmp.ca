# Firebase modules

- **index.ts** – Init and exports (app, firestore, database, storage).
- **gpxStorage.ts** – Upload GPX to Storage, save metadata to Realtime Database.
- **fetchRoutes.ts** – Read route metadata from Firestore (`fetchRouteMetadata`, `fetchRoutesWithGPX`).
- **downloadGpx.ts** – Get GPX from Storage: `getGpxDownloadUrl`, `getGpxFileAsText`, `downloadGpxToFile`, `openGpxInExternalApp`.

## Usage in components

```ts
import { useFirebaseRoutes } from "@/context/FirebaseContext";
import { getGpxDownloadUrl, getGpxFileAsText } from "@/lib/firebase/downloadGpx";
import { getRouteTitleForDisplay } from "@/lib/firebase/fetchRoutes";

function RouteList() {
  const { routes, loading, error, hasInvalidGpx } = useFirebaseRoutes();

  const handleOpenGpx = async (userId: string, routeId: string) => {
    const url = await getGpxDownloadUrl(userId, routeId, { subPath: "routes" });
    Linking.openURL(url);
  };

  return (
    <FlatList
      data={routes}
      keyExtractor={(r) => r.id}
      renderItem={({ item }) => (
        <Pressable onPress={() => handleOpenGpx(item.data.userId!, item.id)}>
          <Text>{getRouteTitleForDisplay(item.data)}</Text>
        </Pressable>
      )}
    />
  );
}
```

## Security rules

- **Firestore:** `firestore.rules` – deploy with `firebase deploy --only firestore:rules`.
- **Realtime Database:** `database.rules.json` – deploy with `firebase deploy --only database`.
- **Storage:** Optional 1MB limit in Firebase Console (Storage → Rules).
