import AVFoundation
import ExpoModulesCore

// Push-to-talk for the Blink Live View Proxy: opens its /ptt WebSocket, sends
// {"type":"start","sampleRate":N}, then the microphone as signed 16-bit mono PCM,
// then {"type":"stop"}. The proxy encodes it and plays it on the camera's speaker.
// Done natively because JS can't read the mic, and so audio never crosses the bridge.
public class MicStreamModule: Module {
  // start/stop arrive concurrently (a quick tap is press + release at once), and
  // AVAudioEngine isn't thread-safe: every engine/socket change goes through this queue.
  private let queue = DispatchQueue(label: "mic-stream")
  // A fresh engine per talk: AVAudioEngine fixes its input format the first time inputNode is
  // touched, and touched before the session allows recording it has 0 channels and installTap aborts.
  private var engine: AVAudioEngine?
  private var socket: URLSessionWebSocketTask?
  private var observers: [NSObjectProtocol] = []

  public func definition() -> ModuleDefinition {
    Name("MicStream")
    Events("onStatus")

    AsyncFunction("start") { (url: URL) async throws in
      guard await Self.allowed() else { throw MicDeniedException() }
      try self.queue.sync { try self.begin(url) }
    }

    AsyncFunction("stop") {
      self.queue.sync { self.end(sendStop: true) }
    }

    OnDestroy {
      self.queue.sync { self.end(sendStop: true) }
    }
  }

  private static func allowed() async -> Bool {
    await withCheckedContinuation { done in
      if #available(iOS 17.0, *) {
        AVAudioApplication.requestRecordPermission { done.resume(returning: $0) }
      } else {
        AVAudioSession.sharedInstance().requestRecordPermission { done.resume(returning: $0) }
      }
    }
  }

  // Runs on `queue`.
  private func begin(_ url: URL) throws {
    end(sendStop: false)
    try useRecordingSession()

    let engine = AVAudioEngine()
    let format = engine.inputNode.inputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0 else { throw NoMicrophoneException() }

    let ws = URLSession.shared.webSocketTask(with: url)
    ws.resume()
    receive(ws)
    ws.send(.string("{\"type\":\"start\",\"sampleRate\":\(Int(format.sampleRate))}")) { _ in }

    self.engine = engine
    self.socket = ws
    do {
      try startEngine(engine, ws)
    } catch {
      end(sendStop: true)
      throw error
    }
    observe(engine)
  }

  // Runs on `queue`.
  private func end(sendStop: Bool) {
    observers.forEach(NotificationCenter.default.removeObserver)
    observers = []
    if let engine {
      engine.inputNode.removeTap(onBus: 0)
      engine.stop()
      self.engine = nil
    }
    if let ws = socket {
      socket = nil
      if sendStop {
        ws.send(.string("{\"type\":\"stop\"}")) { _ in ws.cancel(with: .normalClosure, reason: nil) }
      } else {
        ws.cancel(with: .normalClosure, reason: nil)
      }
      // Hand the session back the way expo-video wants it.
      try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
    }
  }

  private func useRecordingSession() throws {
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
    try session.setActive(true)
  }

  private func startEngine(_ engine: AVAudioEngine, _ ws: URLSessionWebSocketTask) throws {
    let input = engine.inputNode
    let format = input.inputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0 else { throw NoMicrophoneException() }
    input.removeTap(onBus: 0)
    input.installTap(onBus: 0, bufferSize: 2048, format: format) { buffer, _ in
      Self.send(buffer, to: ws)
    }
    engine.prepare()
    try engine.start()
  }

  // expo-video puts the session back to .playback whenever a player changes state,
  // which silences the mic; take it back and restart the engine while talking.
  private func observe(_ engine: AVAudioEngine) {
    let center = NotificationCenter.default
    observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: nil) { [weak self] _ in
      self?.queue.async {
        guard let self, self.socket != nil, AVAudioSession.sharedInstance().category != .playAndRecord else { return }
        try? self.useRecordingSession()
      }
    })
    observers.append(center.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil) { [weak self] _ in
      self?.queue.async {
        guard let self, let engine = self.engine, let ws = self.socket else { return }
        try? self.startEngine(engine, ws)
      }
    })
  }

  private static func send(_ buffer: AVAudioPCMBuffer, to ws: URLSessionWebSocketTask) {
    guard let samples = buffer.floatChannelData?[0] else { return }
    let count = Int(buffer.frameLength)
    var pcm = [Int16](repeating: 0, count: count)
    for i in 0..<count {
      pcm[i] = Int16(max(-1, min(1, samples[i])) * Float(Int16.max))
    }
    ws.send(.data(pcm.withUnsafeBufferPointer { Data(buffer: $0) })) { _ in }
  }

  private func receive(_ ws: URLSessionWebSocketTask) {
    ws.receive { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(.string(let text)):
        if let json = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any] {
          self.sendEvent("onStatus", json)
        }
        self.receive(ws)
      case .success:
        self.receive(ws)
      case .failure(let error):
        self.queue.async {
          guard self.socket === ws else { return } // closed on purpose
          self.sendEvent("onStatus", ["type": "error", "message": error.localizedDescription])
          self.end(sendStop: false)
        }
      }
    }
  }
}

final class NoMicrophoneException: Exception {
  override var reason: String {
    "The microphone isn't available right now. Try again in a moment."
  }
}

final class MicDeniedException: Exception {
  override var reason: String {
    "Microphone access is off. Turn it on in Settings › Smart Home."
  }
}
