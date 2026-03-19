/**
 * Mapillary API v4 — upload street-level imagery.
 * Creates an upload slot then uploads the image with GPS and compass metadata.
 *
 * Mapillary upload flow (as of public docs):
 * - OAuth scope "upload" is required.
 * - Image upload APIs may be documented in Mapillary's developer docs or
 *   implemented by mapillary_tools; this module provides the structure.
 *   If endpoints differ, update GRAPH_API_BASE or add upload-specific base URL.
 */

const GRAPH_API_BASE = "https://graph.mapillary.com";

export interface MapillaryUploadParams {
  imageUri: string;
  latitude: number;
  longitude: number;
  heading: number;
  accessToken: string;
  /** Optional: sequence ID if adding to an existing sequence. */
  sequenceId?: string;
  /** Optional: capture time in ISO 8601. Defaults to now. */
  capturedAt?: string;
}

export interface MapillaryUploadResult {
  success: boolean;
  imageId?: string;
  sequenceId?: string;
  error?: string;
}

/**
 * Upload a single image to Mapillary with location and compass angle.
 * Step 1: Create upload (POST /uploads or equivalent) to get an upload ID/URL.
 * Step 2: Upload image and metadata (POST /images or PUT to upload URL).
 *
 * Note: Mapillary's public API documentation focuses on read endpoints.
 * If this fails with 404/405, the upload flow may require different endpoints
 * (e.g. from mapillary_tools or Mapillary support). The structure here
 * follows the standard pattern: create upload → send file + metadata.
 */
export async function uploadToMapillary(
  params: MapillaryUploadParams,
): Promise<MapillaryUploadResult> {
  const {
    imageUri,
    latitude,
    longitude,
    heading,
    accessToken,
    sequenceId,
    capturedAt,
  } = params;
  const capturedAtIso = capturedAt ?? new Date().toISOString();

  const authHeader = `OAuth ${accessToken}`;

  try {
    // Step 1: Create upload slot (upload ID or upload URL).
    // Mapillary may use POST /uploads with optional sequence_id; response gives upload URL or image_id.
    const createBody: Record<string, unknown> = {
      captured_at: capturedAtIso,
      compass_angle: heading,
      latitude,
      longitude,
    };
    if (sequenceId) createBody.sequence_id = sequenceId;

    const createRes = await fetch(`${GRAPH_API_BASE}/uploads`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify(createBody),
    });

    if (!createRes.ok) {
      const text = await createRes.text();
      return {
        success: false,
        error: `Create upload failed (${createRes.status}): ${text}`,
      };
    }

    const createData = (await createRes.json()) as {
      upload_url?: string;
      upload_id?: string;
      image_id?: string;
      sequence_id?: string;
    };

    const uploadUrl = createData.upload_url;
    const uploadId = createData.upload_id ?? createData.image_id;

    // Step 2: If we got an upload URL, send the image file. Otherwise assume create response is enough.
    if (uploadUrl && imageUri) {
      const formData = new FormData();
      formData.append("file", {
        uri: imageUri,
        type: "image/jpeg",
        name: "image.jpg",
      } as any);

      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          Authorization: authHeader,
        },
        body: formData,
      });

      if (!uploadRes.ok) {
        const text = await uploadRes.text();
        return {
          success: false,
          error: `Image upload failed (${uploadRes.status}): ${text}`,
        };
      }
    } else if (imageUri && uploadId) {
      // Alternative: single multipart POST to /images with file + metadata.
      const formData = new FormData();
      formData.append("file", {
        uri: imageUri,
        type: "image/jpeg",
        name: "image.jpg",
      } as any);
      formData.append("upload_id", String(uploadId));
      formData.append("captured_at", capturedAtIso);
      formData.append("compass_angle", String(heading));
      formData.append("latitude", String(latitude));
      formData.append("longitude", String(longitude));
      if (sequenceId) formData.append("sequence_id", sequenceId);

      const imgRes = await fetch(`${GRAPH_API_BASE}/images`, {
        method: "POST",
        headers: {
          Authorization: authHeader,
        },
        body: formData,
      });

      if (!imgRes.ok) {
        const text = await imgRes.text();
        return {
          success: false,
          error: `Image POST failed (${imgRes.status}): ${text}`,
        };
      }

      const imgData = (await imgRes.json()) as {
        id?: string;
        sequence_id?: string;
      };
      return {
        success: true,
        imageId: imgData.id ?? uploadId,
        sequenceId: imgData.sequence_id ?? sequenceId,
      };
    }

    return {
      success: true,
      imageId: uploadId,
      sequenceId: createData.sequence_id ?? sequenceId,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { success: false, error: message };
  }
}
