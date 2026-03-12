import ExpoModulesCore
import MoonshineVoice

/// Expo native module bridging Moonshine Voice to React Native.
/// Provides streaming mic transcription, file transcription, and intent recognition.
public class MoonshineVoiceModule: Module {
  private var transcriber: Transcriber?
  private var micTranscriber: MicTranscriber?
  private var intentRecognizer: IntentRecognizer?

  /// Accumulated text from the current streaming session.
  private var streamingText: String = ""
  private var isStreaming: Bool = false

  public func definition() -> ModuleDefinition {
    Name("MoonshineVoice")

    // MARK: - Events

    Events(
      "onPartialTranscript",
      "onLineCompleted",
      "onIntentRecognized"
    )

    // MARK: - Sync functions

    Function("isAvailable") {
      return true
    }

    Function("isModelLoaded") {
      return self.transcriber != nil
    }

    // MARK: - Async functions

    AsyncFunction("loadModel") { (modelPath: String, modelArch: Int) -> Bool in
      return try await self.doLoadModel(modelPath: modelPath, modelArch: modelArch)
    }

    AsyncFunction("loadBundledModel") { (modelArch: Int) -> Bool in
      guard let bundlePath = Bundle.main.resourcePath else {
        throw MoonshineError.modelNotFound
      }
      let modelDir = (bundlePath as NSString).appendingPathComponent("moonshine-models")
      return try await self.doLoadModel(modelPath: modelDir, modelArch: modelArch)
    }

    AsyncFunction("unloadModel") {
      self.stopMicIfNeeded()
      self.intentRecognizer = nil
      self.transcriber = nil
    }

    AsyncFunction("startStreaming") {
      guard let transcriber = self.transcriber else {
        throw MoonshineError.modelNotLoaded
      }
      guard !self.isStreaming else {
        throw MoonshineError.alreadyStreaming
      }

      self.streamingText = ""
      self.isStreaming = true

      let mic = MicTranscriber(transcriber: transcriber)
      mic.addListener(self.makeTranscriptListener())
      if let ir = self.intentRecognizer {
        mic.addListener(ir)
      }
      try mic.start()
      self.micTranscriber = mic
    }

    AsyncFunction("stopStreaming") { () -> String in
      self.stopMicIfNeeded()
      let result = self.streamingText
      self.streamingText = ""
      self.isStreaming = false
      return result
    }

    AsyncFunction("transcribeFile") { (filePath: String) -> [String: Any] in
      guard let transcriber = self.transcriber else {
        throw MoonshineError.modelNotLoaded
      }

      let url = URL(fileURLWithPath: filePath)
      let result = try transcriber.transcribeFile(url)

      return [
        "text": result.text,
        "duration": result.duration,
        "segments": result.lines.map { line in
          [
            "text": line.text,
            "startTime": line.startTime,
            "duration": line.duration,
          ] as [String: Any]
        },
      ]
    }

    AsyncFunction("registerIntent") { (triggerPhrase: String, intentName: String) in
      guard let ir = self.intentRecognizer else {
        throw MoonshineError.intentRecognizerNotLoaded
      }
      ir.registerIntent(triggerPhrase: triggerPhrase, name: intentName) {
        [weak self] phrase, utterance, similarity in
        self?.sendEvent("onIntentRecognized", [
          "intent": phrase,
          "utterance": utterance,
          "similarity": similarity,
        ])
      }
    }

    AsyncFunction("unregisterIntent") { (intentName: String) in
      self.intentRecognizer?.unregisterIntent(name: intentName)
    }

    AsyncFunction("clearIntents") {
      self.intentRecognizer?.clearIntents()
    }
  }

  // MARK: - Private helpers

  private func doLoadModel(modelPath: String, modelArch: Int) throws -> Bool {
    let arch = self.mapArch(modelArch)
    let t = try Transcriber(modelPath: modelPath, modelArch: arch)
    self.transcriber = t

    // Try to load intent recognizer (Gemma embeddings) — optional, non-fatal if missing
    if let embeddingPath = self.findEmbeddingModel(near: modelPath) {
      self.intentRecognizer = try? IntentRecognizer(
        modelPath: embeddingPath,
        modelArch: .gemma300M,
        threshold: 0.75
      )
    }

    return true
  }

  private func mapArch(_ raw: Int) -> ModelArch {
    switch raw {
    case 0: return .tiny
    case 1: return .base
    case 2: return .tinyStreaming
    case 3: return .baseStreaming
    case 4: return .smallStreaming
    case 5: return .mediumStreaming
    default: return .tinyStreaming
    }
  }

  private func findEmbeddingModel(near modelPath: String) -> String? {
    let parent = (modelPath as NSString).deletingLastPathComponent
    let embeddingDir = (parent as NSString).appendingPathComponent("gemma-embedding")
    if FileManager.default.fileExists(atPath: embeddingDir) {
      return embeddingDir
    }
    return nil
  }

  private func stopMicIfNeeded() {
    micTranscriber?.stop()
    micTranscriber = nil
  }

  private func makeTranscriptListener() -> TranscriptEventListener {
    return ModuleTranscriptListener(module: self)
  }

  /// Bridge class that forwards Moonshine transcript events to JS.
  fileprivate class ModuleTranscriptListener: TranscriptEventListener {
    weak var module: MoonshineVoiceModule?

    init(module: MoonshineVoiceModule) {
      self.module = module
    }

    func onLineTextChanged(_ event: TranscriptLineEvent) {
      module?.streamingText = event.line.text
      module?.sendEvent("onPartialTranscript", [
        "text": event.line.text,
        "isComplete": event.line.isComplete,
        "lineId": event.line.lineId,
        "startTime": event.line.startTime,
      ])
    }

    func onLineCompleted(_ event: TranscriptLineEvent) {
      module?.sendEvent("onLineCompleted", [
        "text": event.line.text,
        "startTime": event.line.startTime,
        "duration": event.line.duration,
        "lineId": event.line.lineId,
      ])
    }
  }
}

// MARK: - Errors

enum MoonshineError: Error, LocalizedError {
  case modelNotFound
  case modelNotLoaded
  case alreadyStreaming
  case intentRecognizerNotLoaded

  var errorDescription: String? {
    switch self {
    case .modelNotFound:
      return "Moonshine model files not found in app bundle."
    case .modelNotLoaded:
      return "No Moonshine model is loaded. Call loadModel() first."
    case .alreadyStreaming:
      return "Streaming is already active. Call stopStreaming() first."
    case .intentRecognizerNotLoaded:
      return "Intent recognizer not available. Embedding model may be missing."
    }
  }
}
