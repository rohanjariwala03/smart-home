import Foundation
import Security
import WatchConnectivity

// Hands the Home Assistant URL + token from the iPhone app to the watch app. Compiled into both:
// the phone sends what it saved for the widget (HA.creds()), the watch keeps it in its own keychain.

struct WatchCreds: Codable, Equatable {
  let url: String
  let token: String
}

final class WatchSync: NSObject, WCSessionDelegate {
  static let shared = WatchSync()

  func start() {
    guard WCSession.isSupported() else { return }
    WCSession.default.delegate = self
    WCSession.default.activate()
  }

  func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
    #if os(iOS)
    push(session)
    #else
    if Keychain.load() == nil { ask() }
    #endif
  }

  #if os(iOS)
  private var payload: [String: Any]? { HA.creds().map { ["url": $0.url, "token": $0.token] } }

  private func push(_ session: WCSession) {
    guard session.activationState == .activated, session.isPaired, session.isWatchAppInstalled, let payload else { return }
    try? session.updateApplicationContext(payload)
  }

  // The watch app was just installed, or asks because it has nothing (this can wake the phone app).
  func sessionWatchStateDidChange(_ session: WCSession) { push(session) }
  func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
    replyHandler(payload ?? [:])
  }

  func sessionDidBecomeInactive(_ session: WCSession) {}
  func sessionDidDeactivate(_ session: WCSession) { session.activate() }
  #else
  func ask() {
    guard WCSession.default.activationState == .activated else { return }
    WCSession.default.sendMessage(["want": "creds"], replyHandler: { [weak self] in self?.store($0) }, errorHandler: nil)
  }

  func session(_ session: WCSession, didReceiveApplicationContext context: [String: Any]) { store(context) }

  private func store(_ context: [String: Any]) {
    guard let url = context["url"] as? String, let token = context["token"] as? String else { return }
    let creds = WatchCreds(url: url, token: token)
    Keychain.save(creds)
    DispatchQueue.main.async { NotificationCenter.default.post(name: .watchCreds, object: creds) }
  }
  #endif
}

#if os(watchOS)
extension Notification.Name { static let watchCreds = Notification.Name("watchCreds") }

enum Keychain {
  private static let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrAccount as String: "ha"]

  static func save(_ c: WatchCreds) {
    guard let data = try? JSONEncoder().encode(c) else { return }
    SecItemDelete(base as CFDictionary)
    SecItemAdd(base.merging([kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock]) { $1 } as CFDictionary, nil)
  }

  static func load() -> WatchCreds? {
    var out: CFTypeRef?
    let query = base.merging([kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]) { $1 }
    guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
    return try? JSONDecoder().decode(WatchCreds.self, from: data)
  }
}
#endif
