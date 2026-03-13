# Moonshine Voice – Android

This module uses the **Moonshine Voice Android SDK** for on-device speech-to-text.

## Dependency

- **Preferred:** The build uses Maven Central: `ai.moonshine:moonshine-voice:0.0.49` when the `libs/` folder has no AAR/JAR. That allows EAS Build to succeed without local binaries.
- **Fallback:** If the Maven artifact is unavailable or you need a specific build, place the Moonshine Voice AAR (and any JARs) in `android/libs/`. The build will then use `fileTree(dir: 'libs', include: ['*.aar', '*.jar'])` instead of Maven.

## Getting the AAR

If you see `Could not find ai.moonshine:moonshine-voice`, you can:

1. Check [Moonshine releases](https://github.com/moonshine-ai/moonshine/releases) for Android artifacts (e.g. `android-examples.tar.gz` or a published AAR).
2. Build from the [moonshine-ai/moonshine](https://github.com/moonshine-ai/moonshine) repo and copy the resulting AAR into `android/libs/`.

Ensure the AAR exposes the `ai.moonshine.voice` package (e.g. `Transcriber`, `MicTranscriber`, `IntentRecognizer`, `ModelArch`, `EmbeddingModelArch`).
