package com.routemasterpro.moonshine

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import ai.moonshine.voice.MicTranscriber
import ai.moonshine.voice.Transcriber
import ai.moonshine.voice.TranscriptEventListener
import ai.moonshine.voice.TranscriptLineEvent
import ai.moonshine.voice.IntentRecognizer
import ai.moonshine.voice.ModelArch
import ai.moonshine.voice.EmbeddingModelArch
import java.io.File

class MoonshineVoiceModule : Module() {
  private var transcriber: Transcriber? = null
  private var micTranscriber: MicTranscriber? = null
  private var intentRecognizer: IntentRecognizer? = null
  private var streamingText: String = ""
  private var isStreaming: Boolean = false

  override fun definition() = ModuleDefinition {
    Name("MoonshineVoice")

    Events("onPartialTranscript", "onLineCompleted", "onIntentRecognized")

    Function("isAvailable") { true }

    Function("isModelLoaded") { transcriber != null }

    AsyncFunction("loadModel") { modelPath: String, modelArch: Int ->
      doLoadModel(modelPath, modelArch)
    }

    AsyncFunction("loadBundledModel") { modelArch: Int ->
      val context = appContext.reactContext ?: throw CodedException("NO_CONTEXT", "App context unavailable", null)
      // Load from assets: models are expected in assets/moonshine-models/
      val t = Transcriber.loadFromAssets(context, "moonshine-models", mapArch(modelArch))
      transcriber = t

      // Try loading intent recognizer from assets (optional)
      try {
        intentRecognizer = IntentRecognizer.loadFromAssets(
          context, "gemma-embedding", EmbeddingModelArch.GEMMA_300M, 0.75f
        )
      } catch (_: Exception) { /* Embedding model not bundled — skip */ }

      true
    }

    AsyncFunction("unloadModel") {
      stopMicIfNeeded()
      intentRecognizer = null
      transcriber = null
    }

    AsyncFunction("startStreaming") {
      val t = transcriber ?: throw CodedException("NOT_LOADED", "No model loaded. Call loadModel() first.", null)
      if (isStreaming) throw CodedException("ALREADY_STREAMING", "Streaming already active.", null)

      streamingText = ""
      isStreaming = true

      val context = appContext.reactContext ?: throw CodedException("NO_CONTEXT", "App context unavailable", null)
      val mic = MicTranscriber(t)
      mic.addListener(createTranscriptListener())
      intentRecognizer?.let { mic.addListener(it) }
      mic.grantPermissions() // Signal that permissions are handled by Expo
      mic.start()
      micTranscriber = mic
    }

    AsyncFunction("stopStreaming") {
      stopMicIfNeeded()
      val result = streamingText
      streamingText = ""
      isStreaming = false
      result
    }

    AsyncFunction("transcribeFile") { filePath: String ->
      val t = transcriber ?: throw CodedException("NOT_LOADED", "No model loaded.", null)
      val result = t.transcribeWithoutStreaming(File(filePath))
      mapOf(
        "text" to (result?.text ?: ""),
        "duration" to (result?.duration ?: 0.0),
        "segments" to (result?.lines?.map { line ->
          mapOf(
            "text" to line.text,
            "startTime" to line.startTime,
            "duration" to line.duration,
          )
        } ?: emptyList<Map<String, Any>>()),
      )
    }

    AsyncFunction("registerIntent") { triggerPhrase: String, intentName: String ->
      val ir = intentRecognizer
        ?: throw CodedException("NO_INTENT", "Intent recognizer not available.", null)
      ir.registerIntent(triggerPhrase, intentName) { phrase, utterance, similarity ->
        sendEvent("onIntentRecognized", mapOf(
          "intent" to phrase,
          "utterance" to utterance,
          "similarity" to similarity,
        ))
      }
    }

    AsyncFunction("unregisterIntent") { intentName: String ->
      intentRecognizer?.unregisterIntent(intentName)
    }

    AsyncFunction("clearIntents") {
      intentRecognizer?.clearIntents()
    }
  }

  private fun doLoadModel(modelPath: String, modelArch: Int): Boolean {
    val t = Transcriber.loadFromFiles(modelPath, mapArch(modelArch))
    transcriber = t

    // Try to load intent recognizer from nearby embedding model dir
    val embeddingDir = File(File(modelPath).parent, "gemma-embedding")
    if (embeddingDir.exists()) {
      try {
        intentRecognizer = IntentRecognizer(
          embeddingDir.absolutePath, EmbeddingModelArch.GEMMA_300M, 0.75f
        )
      } catch (_: Exception) { /* Non-fatal */ }
    }

    return true
  }

  private fun mapArch(raw: Int): ModelArch = when (raw) {
    0 -> ModelArch.TINY
    1 -> ModelArch.BASE
    2 -> ModelArch.TINY_STREAMING
    3 -> ModelArch.BASE_STREAMING
    4 -> ModelArch.SMALL_STREAMING
    5 -> ModelArch.MEDIUM_STREAMING
    else -> ModelArch.TINY_STREAMING
  }

  private fun stopMicIfNeeded() {
    micTranscriber?.stop()
    micTranscriber = null
  }

  private fun createTranscriptListener(): TranscriptEventListener {
    return object : TranscriptEventListener {
      override fun onLineTextChanged(event: TranscriptLineEvent) {
        streamingText = event.line.text
        sendEvent("onPartialTranscript", mapOf(
          "text" to event.line.text,
          "isComplete" to event.line.isComplete,
          "lineId" to event.line.lineId,
          "startTime" to event.line.startTime,
        ))
      }

      override fun onLineCompleted(event: TranscriptLineEvent) {
        sendEvent("onLineCompleted", mapOf(
          "text" to event.line.text,
          "startTime" to event.line.startTime,
          "duration" to event.line.duration,
          "lineId" to event.line.lineId,
        ))
      }
    }
  }
}
