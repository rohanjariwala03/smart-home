import AppIntents
import Foundation
import Security
import SwiftUI
import WidgetKit

// Home Assistant REST client and the App Intents built on it. Compiled into both the app
// (Siri and the Shortcuts app look for intents there) and the widget extension (widget taps).

// MARK: - Home Assistant

enum HAError: Error, CustomLocalizedStringResourceConvertible {
  case notSignedIn, http(Int), adminOnly

  var localizedStringResource: LocalizedStringResource {
    switch self {
    case .notSignedIn: "Open Smart Home and connect to Home Assistant first."
    case .http: "Couldn't reach Home Assistant."
    case .adminOnly: "Timers need a Home Assistant admin token. Change it in Smart Home › Settings."
    }
  }
}

struct HAState: Decodable {
  let entity_id: String
  let state: String
  let attributes: Attributes

  struct Attributes: Decodable {
    let friendly_name: String?
    let brightness: Double?
    let rgb_color: [Double]?
  }

  var domain: String { String(entity_id.split(separator: ".")[0]) }
  var name: String { attributes.friendly_name ?? entity_id }
  var isOn: Bool { state == "on" }
  var unavailable: Bool { state == "unavailable" || state == "unknown" }
  var runnable: Bool { domain == "scene" || domain == "script" }

  var symbol: String {
    switch domain {
    case "light": "lightbulb.fill"
    case "fan": "fan.fill"
    case "scene": "sparkles"
    case "script": "play.fill"
    default: "power"
    }
  }

  var tint: Color {
    guard let c = attributes.rgb_color, c.count == 3 else { return .yellow }
    return Color(red: c[0] / 255, green: c[1] / 255, blue: c[2] / 255)
  }

  var status: String {
    if unavailable { return "Unavailable" }
    if runnable { return "Tap to run" }
    guard isOn else { return "Off" }
    guard let b = attributes.brightness else { return "On" }
    return "On · \(Int((b / 2.55).rounded()))%"
  }
}

enum HA {
  static let domains = ["light", "switch", "fan", "input_boolean", "scene", "script"]
  /// Alexa Media Player's switches on each Echo (no device registry here, so by name; the app uses the registry).
  static func isEchoSetting(_ id: String) -> Bool {
    id.hasPrefix("switch.") && ["_do_not_disturb", "_shuffle", "_repeat", "_amazon_kids"].contains { id.hasSuffix($0) }
  }

  struct Creds: Decodable { let url: String; let token: String }

  // Written by the app (src/ha.tsx, `shareWithWidget`) via expo-secure-store into the shared keychain group.
  static func creds() -> Creds? { shared("ha-widget") }

  /// Entity ids starred for the app's Home tab, in order (src/favourites.tsx).
  static func favourites() -> [String] { shared("ha-favourites") ?? [] }

  private static func shared<T: Decodable>(_ account: String) -> T? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "app:no-auth",
      kSecAttrAccount as String: Data(account.utf8),
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var out: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
    return try? JSONDecoder().decode(T.self, from: data)
  }

  /// Favourites first, in their order, then the rest as they were.
  static func favouritesFirst(_ states: [HAState]) -> [HAState] {
    let favs = favourites()
    return states.filter { favs.contains($0.entity_id) }.sorted { favs.firstIndex(of: $0.entity_id)! < favs.firstIndex(of: $1.entity_id)! }
      + states.filter { !favs.contains($0.entity_id) }
  }

  static func request(_ path: String, body: [String: Any]? = nil) async throws -> Data {
    guard let c = creds(), let url = URL(string: c.url + path) else { throw HAError.notSignedIn }
    var req = URLRequest(url: url, timeoutInterval: 8)
    req.setValue("Bearer \(c.token)", forHTTPHeaderField: "Authorization")
    if let body {
      req.httpMethod = "POST"
      req.setValue("application/json", forHTTPHeaderField: "Content-Type")
      req.httpBody = try JSONSerialization.data(withJSONObject: body)
    }
    let (data, res) = try await URLSession.shared.data(for: req)
    let code = (res as? HTTPURLResponse)?.statusCode ?? 0
    if code == 401, path.hasPrefix("/api/config/") { throw HAError.adminOnly }
    guard code == 200 else { throw HAError.http(code) }
    return data
  }

  static func states() async throws -> [HAState] {
    try JSONDecoder().decode([HAState].self, from: await request("/api/states"))
      .filter { domains.contains($0.domain) && !$0.entity_id.hasPrefix("switch.blink_proxy_") && !$0.entity_id.hasSuffix("_motion_detection") && !HA.isEchoSetting($0.entity_id) }
      .sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
  }

  static func state(_ id: String) async throws -> HAState {
    try JSONDecoder().decode(HAState.self, from: await request("/api/states/\(id)"))
  }

  static func toggle(_ id: String) async throws {
    let domain = String(id.split(separator: ".")[0])
    let service = domain == "scene" || domain == "script" ? "turn_on" : "toggle"
    _ = try await request("/api/services/\(domain)/\(service)", body: ["entity_id": id])
  }

  static func set(_ id: String, on: Bool) async throws {
    let domain = String(id.split(separator: ".")[0])
    _ = try await request("/api/services/\(domain)/turn_\(on ? "on" : "off")", body: ["entity_id": id])
  }

  // Same automation as `setTimer` in src/automations.ts (same id and alias), so the app shows its countdown.
  static func timer(_ id: String, name: String, on: Bool, until: Date) async throws {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
    let stamp = f.string(from: until)
    let day = String(stamp.prefix(10)), at = String(stamp.suffix(8))
    let domain = String(id.split(separator: ".")[0])
    let config: [String: Any] = [
      "alias": "\(name): timer \(on ? "on" : "off") until \(stamp)",
      "description": "Created by the Smart Home app",
      "triggers": [["trigger": "time", "at": at]],
      "conditions": [["condition": "template", "value_template": "{{ now().strftime('%Y-%m-%d') == '\(day)' }}"]],
      "actions": [
        ["action": "\(domain).turn_\(on ? "on" : "off")", "target": ["entity_id": id]],
        ["action": "automation.turn_off", "target": ["entity_id": "{{ this.entity_id }}"]],
      ],
      "mode": "single",
    ]
    _ = try await request("/api/config/automation/config/smarthome_timer_\(id.replacingOccurrences(of: ".", with: "_"))", body: config)
  }

  /// Widgets and controls show the new state now rather than at their next refresh.
  static func refreshWidgets() {
    WidgetCenter.shared.reloadAllTimelines()
    if #available(iOS 18.0, *) { ControlCenter.shared.reloadAllControls() }
  }
}

// MARK: - Entities

struct DeviceEntity: AppEntity {
  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Device"
  static let defaultQuery = DeviceQuery()

  let id: String
  let name: String

  var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }
}

struct DeviceQuery: EntityStringQuery {
  func entities(for identifiers: [String]) async throws -> [DeviceEntity] {
    // Offline: keep the user's picks rather than dropping them.
    let all = (try? await suggestedEntities()) ?? []
    return identifiers.map { id in all.first { $0.id == id } ?? DeviceEntity(id: id, name: id) }
  }

  func entities(matching string: String) async throws -> [DeviceEntity] {
    try await suggestedEntities().filter { $0.name.localizedCaseInsensitiveContains(string) }
  }

  func suggestedEntities() async throws -> [DeviceEntity] {
    try await HA.favouritesFirst(HA.states()).map { DeviceEntity(id: $0.entity_id, name: $0.name) }
  }
}

enum TimerLength: Int, AppEnum {
  case m15 = 15, m30 = 30, h1 = 60, h2 = 120, h4 = 240, h8 = 480

  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Duration"
  static let caseDisplayRepresentations: [TimerLength: DisplayRepresentation] = [
    .m15: "15 minutes", .m30: "30 minutes", .h1: "an hour", .h2: "2 hours", .h4: "4 hours", .h8: "8 hours",
  ]
}

struct CameraEntity: AppEntity {
  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Camera"
  static let defaultQuery = CameraQuery()

  let id: String // the Blink proxy's camera slug
  let name: String

  var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }
}

struct CameraQuery: EntityStringQuery {
  // Blink proxy snapshot cameras (camera.blink_proxy_<slug>, attribute snapshot_of = slug): the ones with live view.
  private struct Camera: Decodable {
    let attributes: Attributes
    struct Attributes: Decodable { let friendly_name: String?; let snapshot_of: String? }
  }

  func suggestedEntities() async throws -> [CameraEntity] {
    try JSONDecoder().decode([Camera].self, from: await HA.request("/api/states")).compactMap { c in
      c.attributes.snapshot_of.map { CameraEntity(id: $0, name: c.attributes.friendly_name ?? $0) }
    }
  }

  func entities(for identifiers: [String]) async throws -> [CameraEntity] {
    let all = (try? await suggestedEntities()) ?? []
    return identifiers.map { id in all.first { $0.id == id } ?? CameraEntity(id: id, name: id) }
  }

  func entities(matching string: String) async throws -> [CameraEntity] {
    try await suggestedEntities().filter { $0.name.localizedCaseInsensitiveContains(string) }
  }
}

// MARK: - Intents

struct ToggleIntent: AppIntent {
  static let title: LocalizedStringResource = "Toggle device"

  @Parameter(title: "Entity ID") var entityId: String

  init() {}
  init(_ entityId: String) { self.entityId = entityId }

  // WidgetKit reloads the timeline after this returns, so the tile shows the new state.
  func perform() async throws -> some IntentResult {
    try await HA.toggle(entityId)
    return .result()
  }
}

struct PowerIntent: AppIntent {
  static let title: LocalizedStringResource = "Turn device on or off"
  static let description = IntentDescription("Switches a light, switch or scene in Home Assistant.")

  @Parameter(title: "Device") var device: DeviceEntity
  @Parameter(title: "Power", default: true, displayName: Bool.IntentDisplayName(true: "on", false: "off")) var on: Bool

  static var parameterSummary: some ParameterSummary { Summary("Turn \(\.$device) \(\.$on)") }

  init() {}
  init(on: Bool) { self.on = on }

  func perform() async throws -> some IntentResult & ProvidesDialog {
    try await HA.set(device.id, on: on)
    HA.refreshWidgets()
    return .result(dialog: "\(device.name) is \(on ? "on" : "off").")
  }
}

struct TimerIntent: AppIntent {
  static let title: LocalizedStringResource = "Turn device on or off for a while"
  static let description = IntentDescription("Switches it now and back again when the time is up. Runs in Home Assistant, so it works with your phone off.")

  @Parameter(title: "Device") var device: DeviceEntity
  @Parameter(title: "Power", default: false, displayName: Bool.IntentDisplayName(true: "on", false: "off")) var on: Bool
  @Parameter(title: "For", requestValueDialog: "For how long?") var length: TimerLength

  static var parameterSummary: some ParameterSummary { Summary("Turn \(\.$device) \(\.$on) for \(\.$length)") }

  init() {}
  init(on: Bool, length: TimerLength) {
    self.on = on
    self.length = length
  }

  func perform() async throws -> some IntentResult & ProvidesDialog {
    // Timer first: if the token can't create automations, nothing changes.
    try await HA.timer(device.id, name: device.name, on: !on, until: .now.addingTimeInterval(Double(length.rawValue * 60)))
    try await HA.set(device.id, on: on)
    HA.refreshWidgets()
    let back = Date.now.addingTimeInterval(Double(length.rawValue * 60)).formatted(date: .omitted, time: .shortened)
    return .result(dialog: "\(device.name) is \(on ? "on" : "off") until \(back).")
  }
}

// Opens the app on the camera's live view (src/app/cameras.tsx reads ?live=).
struct ShowCameraIntent: AppIntent {
  static let title: LocalizedStringResource = "Show camera live"
  static let description = IntentDescription("Opens Smart Home on a Blink camera's live view.")

  @Parameter(title: "Camera") var camera: CameraEntity

  static var parameterSummary: some ParameterSummary { Summary("Show \(\.$camera) live") }

  func perform() async throws -> some IntentResult & OpensIntent {
    var url = URLComponents(string: "smarthome://cameras")!
    url.queryItems = [URLQueryItem(name: "live", value: camera.id)]
    return .result(opensIntent: OpenURLIntent(url.url!))
  }
}

// MARK: - Siri

// Every phrase has to name the app. For no app name ("Hey Siri, porch light off for an hour"),
// make a shortcut with that name in the Shortcuts app using one of these actions.
struct SmartHomeShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: TimerIntent(on: false, length: .h1),
      phrases: [
        "Turn off \(\.$device) for an hour in \(.applicationName)",
        "\(\.$device) off for an hour in \(.applicationName)",
      ],
      shortTitle: "Off for an hour",
      systemImageName: "timer"
    )
    AppShortcut(
      intent: TimerIntent(on: true, length: .h1),
      phrases: [
        "Turn on \(\.$device) for an hour in \(.applicationName)",
        "\(\.$device) on for an hour in \(.applicationName)",
      ],
      shortTitle: "On for an hour",
      systemImageName: "timer"
    )
    AppShortcut(
      intent: TimerIntent(),
      phrases: ["Set a \(.applicationName) timer for \(\.$device)", "\(.applicationName) timer"],
      shortTitle: "Timer",
      systemImageName: "timer"
    )
    AppShortcut(
      intent: ShowCameraIntent(),
      phrases: [
        "Show \(\.$camera) in \(.applicationName)",
        "Show the \(\.$camera) camera in \(.applicationName)",
        "Show my cameras in \(.applicationName)",
      ],
      shortTitle: "Show camera",
      systemImageName: "video.fill"
    )
    AppShortcut(
      intent: PowerIntent(on: true),
      phrases: ["Turn on \(\.$device) in \(.applicationName)", "\(\.$device) on in \(.applicationName)"],
      shortTitle: "Turn on",
      systemImageName: "power"
    )
    AppShortcut(
      intent: PowerIntent(on: false),
      phrases: ["Turn off \(\.$device) in \(.applicationName)", "\(\.$device) off in \(.applicationName)"],
      shortTitle: "Turn off",
      systemImageName: "power"
    )
  }
}
