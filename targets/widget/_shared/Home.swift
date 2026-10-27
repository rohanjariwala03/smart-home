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
  /// Switches that are a setting of another device: an Echo's (Alexa Media Player) or a Govee light's. By name: no device registry here.
  static func isEchoSetting(_ id: String) -> Bool {
    id.hasPrefix("switch.") && ["_do_not_disturb", "_shuffle", "_repeat", "_amazon_kids", "_music_mode", "_dreamview"].contains { id.hasSuffix($0) }
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
    // Not the URLError itself: it carries the network path, which App Intents can't send back to iOS, and the app
    // aborts (seen on launch while Home Assistant was unreachable).
    let data: Data, res: URLResponse
    do { (data, res) = try await URLSession.shared.data(for: req) } catch { throw HAError.http(0) }
    let code = (res as? HTTPURLResponse)?.statusCode ?? 0
    if code == 401, path.hasPrefix("/api/config/") { throw HAError.adminOnly }
    guard code == 200 else { throw HAError.http(code) }
    return data
  }

  static func states() async throws -> [HAState] {
    try JSONDecoder().decode([HAState].self, from: await request("/api/states"))
      .filter { domains.contains($0.domain) && !$0.entity_id.hasSuffix("_motion_detection") && !HA.isEchoSetting($0.entity_id) }
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

  /// The alarm panels (Blink systems) Home Assistant can reach right now.
  static func alarms() async throws -> [HAState] {
    try JSONDecoder().decode([HAState].self, from: await request("/api/states"))
      .filter { $0.domain == "alarm_control_panel" && !$0.unavailable }
  }

  static func setArmed(_ armed: Bool) async throws -> [HAState] {
    let alarms = try await alarms()
    if !alarms.isEmpty {
      _ = try await request(
        "/api/services/alarm_control_panel/alarm_\(armed ? "arm_away" : "disarm")", body: ["entity_id": alarms.map(\.entity_id)])
    }
    return alarms
  }

  /// Widgets and controls show the new state now rather than at their next refresh.
  static func refreshWidgets() {
    WidgetCenter.shared.reloadAllTimelines()
    if #available(iOS 18.0, *) { ControlCenter.shared.reloadAllControls() }
  }
}

// MARK: - Thermostat

struct HAClimate: Decodable {
  let entity_id: String
  let state: String
  let attributes: Attributes

  struct Attributes: Decodable {
    let friendly_name: String?
    let current_temperature: Double?
    let current_humidity: Double?
    let temperature: Double?
    let target_temp_low: Double?
    let target_temp_high: Double?
    let target_temp_step: Double?
    let min_temp: Double?
    let max_temp: Double?
    let hvac_action: String?
  }

  static let modeNames = ["off": "Off", "heat": "Heat", "cool": "Cool", "heat_cool": "Heat/Cool", "auto": "Auto", "dry": "Dry", "fan_only": "Fan"]

  var name: String { attributes.friendly_name ?? entity_id }
  var unavailable: Bool { state == "unavailable" || state == "unknown" }
  var off: Bool { state == "off" || unavailable }
  /// Heat/Cool: a low and a high set point instead of one.
  var range: Bool { attributes.temperature == nil && attributes.target_temp_low != nil }
  var step: Double { attributes.target_temp_step ?? ((attributes.max_temp ?? 0) > 40 ? 1 : 0.5) }
  var heating: Bool { attributes.hvac_action == "heating" || attributes.hvac_action == "preheating" }
  var cooling: Bool { attributes.hvac_action == "cooling" || (!heating && state == "cool") }
  var working: Bool { heating || attributes.hvac_action == "cooling" }
  var symbol: String { off ? "thermometer.medium" : cooling ? "snowflake" : heating ? "flame.fill" : "thermometer.medium" }
  var tint: Color { cooling ? Color(red: 0.25, green: 0.61, blue: 1) : Color(red: 1, green: 0.54, blue: 0.24) }

  /// "Heating", "Idle", "Off" (same words as the app, src/climate.ts).
  var doing: String {
    if unavailable { return "Unavailable" }
    if state == "off" { return "Off" }
    switch attributes.hvac_action {
    case "heating", "preheating": return "Heating"
    case "cooling": return "Cooling"
    case "idle": return "Idle"
    case "fan": return "Fan"
    default: return HAClimate.modeNames[state] ?? state
    }
  }

  /// "22°" or "20°–24°"
  var target: String? {
    if off { return nil }
    if let t = attributes.temperature { return deg(t) }
    if let l = attributes.target_temp_low, let h = attributes.target_temp_high { return "\(deg(l))–\(deg(h))" }
    return nil
  }

  /// "Heating to 22°", "Idle · 20°–24°"
  var summary: String { target.map { "\(doing)\(working ? " to" : " ·") \($0)" } ?? doing }
}

/// One decimal (21.5°), whole numbers without one (21°).
func deg(_ v: Double?) -> String { v.map { "\($0.formatted(.number.precision(.fractionLength(0...1))))°" } ?? "–" }

extension HA {
  /// The first thermostat. Picked out of the raw list, so other entities' attributes don't have to decode.
  static func thermostat() async throws -> HAClimate? {
    let all = try JSONSerialization.jsonObject(with: await request("/api/states")) as? [[String: Any]] ?? []
    guard let raw = all.first(where: { ($0["entity_id"] as? String)?.hasPrefix("climate.") == true }) else { return nil }
    return try JSONDecoder().decode(HAClimate.self, from: JSONSerialization.data(withJSONObject: raw))
  }

  static func climate(_ id: String) async throws -> HAClimate {
    try JSONDecoder().decode(HAClimate.self, from: await request("/api/states/\(id)"))
  }

  /// Sets one set point, or in Heat/Cool moves the low and high together (keeping the gap) so `to` is in the middle.
  static func setTemperature(_ t: HAClimate, to value: Double) async throws -> String {
    let a = t.attributes
    let clamp = { (v: Double) in min(a.max_temp ?? 100, max(a.min_temp ?? 0, (v / t.step).rounded() * t.step)) }
    var body: [String: Any] = ["entity_id": t.entity_id]
    let said: String
    if t.range, let l = a.target_temp_low, let h = a.target_temp_high {
      let half = (h - l) / 2
      body["target_temp_low"] = clamp(value - half)
      body["target_temp_high"] = clamp(value + half)
      said = "Heat to \(deg(clamp(value - half))), cool to \(deg(clamp(value + half)))."
    } else {
      body["temperature"] = clamp(value)
      said = "Set to \(deg(clamp(value)))."
    }
    _ = try await request("/api/services/climate/set_temperature", body: body)
    return said
  }

  /// One step warmer or cooler: a set point (`key`), or in Heat/Cool both together when `key` is empty.
  static func nudge(_ t: HAClimate, key: String, by: Double) async throws {
    let a = t.attributes
    let clamp = { (v: Double) in min(a.max_temp ?? 100, max(a.min_temp ?? 0, v)) }
    var body: [String: Any] = ["entity_id": t.entity_id]
    if t.range, let l = a.target_temp_low, let h = a.target_temp_high {
      body["target_temp_low"] = key == "target_temp_high" ? l : clamp(l + by)
      body["target_temp_high"] = key == "target_temp_low" ? h : clamp(h + by)
    } else if let v = a.temperature {
      body["temperature"] = clamp(v + by)
    } else { return }
    _ = try await request("/api/services/climate/set_temperature", body: body)
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

  let id: String // the Blink camera's slug
  let name: String

  var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }
}

struct CameraQuery: EntityStringQuery {
  // Blink snapshot cameras (attribute snapshot_of = slug): the ones with live view. Blink Live View Proxy's
  // (camera.blink_proxy_<slug>) are skipped while it's still installed next to Blink Instant Events.
  private struct Camera: Decodable {
    let entity_id: String
    let attributes: Attributes
    struct Attributes: Decodable { let friendly_name: String?; let snapshot_of: String? }
  }

  func suggestedEntities() async throws -> [CameraEntity] {
    try JSONDecoder().decode([Camera].self, from: await HA.request("/api/states")).compactMap { c in
      c.entity_id.hasPrefix("camera.blink_proxy_") ? nil : c.attributes.snapshot_of.map { CameraEntity(id: $0, name: c.attributes.friendly_name ?? $0) }
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

struct ArmCamerasIntent: AppIntent {
  static let title: LocalizedStringResource = "Arm cameras"
  static let description = IntentDescription("Arms the Blink cameras, so motion alerts again.")

  func perform() async throws -> some IntentResult & ProvidesDialog {
    .result(dialog: try await HA.setArmed(true).isEmpty ? "There are no cameras to arm." : "The cameras are armed.")
  }
}

struct DisarmCamerasIntent: AppIntent {
  static let title: LocalizedStringResource = "Disarm cameras"
  static let description = IntentDescription("Disarms the Blink cameras. Asks for Face ID first.")
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

  func perform() async throws -> some IntentResult & ProvidesDialog {
    .result(dialog: try await HA.setArmed(false).isEmpty ? "There are no cameras to disarm." : "The cameras are disarmed.")
  }
}

struct CamerasArmedIntent: AppIntent {
  static let title: LocalizedStringResource = "Are the cameras armed?"
  static let description = IntentDescription("Says whether the Blink cameras are armed.")

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let states = try await HA.alarms().map(\.state)
    if states.isEmpty { return .result(dialog: "Home Assistant can't see the cameras right now.") }
    let armed = states.allSatisfy { $0.hasPrefix("arm") }
    return .result(dialog: armed ? "Yes, the cameras are armed." : "No, the cameras are disarmed.")
  }
}

// Held back in Home Assistant (smarthome_push.snooze, group "motion"), so it holds with the phone off.
struct SnoozeCameraAlertsIntent: AppIntent {
  static let title: LocalizedStringResource = "Snooze camera alerts"
  static let description = IntentDescription("Stops camera alerts from Smart Home for a while. Alexa still announces motion.")

  @Parameter(title: "For", default: .h1) var length: TimerLength

  static var parameterSummary: some ParameterSummary { Summary("Snooze camera alerts for \(\.$length)") }

  func perform() async throws -> some IntentResult & ProvidesDialog {
    _ = try await HA.request("/api/services/smarthome_push/snooze", body: ["key": "motion", "minutes": length.rawValue])
    let until = Date.now.addingTimeInterval(Double(length.rawValue * 60)).formatted(date: .omitted, time: .shortened)
    return .result(dialog: "Camera alerts are snoozed until \(until).")
  }
}

struct NudgeThermostatIntent: AppIntent {
  static let title: LocalizedStringResource = "Thermostat warmer or cooler"
  static let isDiscoverable = false // the widget's − and + buttons

  @Parameter(title: "Entity ID") var entityId: String
  @Parameter(title: "Set point") var key: String
  @Parameter(title: "Warmer") var warmer: Bool

  init() {}
  init(_ entityId: String, key: String = "", warmer: Bool) {
    self.entityId = entityId
    self.key = key
    self.warmer = warmer
  }

  func perform() async throws -> some IntentResult {
    let t = try await HA.climate(entityId)
    try await HA.nudge(t, key: key, by: warmer ? t.step : -t.step)
    // Give the thermostat a moment to take it, so the widget reloads with the new set point.
    try? await Task.sleep(for: .seconds(1.5))
    return .result()
  }
}

struct SetTemperatureIntent: AppIntent {
  static let title: LocalizedStringResource = "Set the thermostat"
  static let description = IntentDescription("Sets the thermostat's temperature. In Heat/Cool it moves both set points, keeping the gap between them.")

  @Parameter(title: "Temperature", requestValueDialog: "To what temperature?") var temperature: Double

  static var parameterSummary: some ParameterSummary { Summary("Set the thermostat to \(\.$temperature)") }

  func perform() async throws -> some IntentResult & ProvidesDialog {
    guard let t = try await HA.thermostat() else { return .result(dialog: "Home Assistant has no thermostat.") }
    if t.off { return .result(dialog: "The thermostat is off. Set its mode first.") }
    let said = try await HA.setTemperature(t, to: temperature)
    HA.refreshWidgets()
    return .result(dialog: "\(said)")
  }
}

enum ThermostatMode: String, AppEnum {
  case off, heat, cool, heat_cool

  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Mode"
  static let caseDisplayRepresentations: [ThermostatMode: DisplayRepresentation] = [
    .off: DisplayRepresentation(title: "off"),
    .heat: DisplayRepresentation(title: "heat", synonyms: ["heating"]),
    .cool: DisplayRepresentation(title: "cool", synonyms: ["cooling", "AC"]),
    .heat_cool: DisplayRepresentation(title: "heat and cool", synonyms: ["auto", "heat cool"]),
  ]
}

struct ThermostatModeIntent: AppIntent {
  static let title: LocalizedStringResource = "Set the thermostat mode"
  static let description = IntentDescription("Switches the thermostat to off, heat, cool, or heat and cool.")

  @Parameter(title: "Mode") var mode: ThermostatMode

  static var parameterSummary: some ParameterSummary { Summary("Set the thermostat to \(\.$mode)") }

  func perform() async throws -> some IntentResult & ProvidesDialog {
    guard let t = try await HA.thermostat() else { return .result(dialog: "Home Assistant has no thermostat.") }
    _ = try await HA.request("/api/services/climate/set_hvac_mode", body: ["entity_id": t.entity_id, "hvac_mode": mode.rawValue])
    HA.refreshWidgets()
    return .result(dialog: "The thermostat is set to \(HAClimate.modeNames[mode.rawValue] ?? mode.rawValue).")
  }
}

struct ThermostatStatusIntent: AppIntent {
  static let title: LocalizedStringResource = "What's the temperature inside?"
  static let description = IntentDescription("Says the temperature inside and what the thermostat is doing.")

  func perform() async throws -> some IntentResult & ProvidesDialog {
    guard let t = try await HA.thermostat() else { return .result(dialog: "Home Assistant has no thermostat.") }
    if t.unavailable { return .result(dialog: "Home Assistant can't reach the thermostat right now.") }
    let humidity = t.attributes.current_humidity.map { ", \(Int($0))% humidity" } ?? ""
    return .result(dialog: "It's \(deg(t.attributes.current_temperature)) inside\(humidity). \(t.summary).")
  }
}

// MARK: - Siri

// Every phrase has to name the app. For no app name ("Hey Siri, porch light off for an hour"),
// make a shortcut with that name in the Shortcuts app using one of these actions.
// iOS takes at most 10 here; the other actions (a timer of any length, "are the cameras armed?") are still in the
// Shortcuts app.
struct SmartHomeShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: ThermostatStatusIntent(),
      phrases: [
        "What's the temperature in \(.applicationName)",
        "How warm is it in \(.applicationName)",
        "What's the thermostat doing in \(.applicationName)",
      ],
      shortTitle: "Temperature inside",
      systemImageName: "thermometer.medium"
    )
    AppShortcut(
      intent: SetTemperatureIntent(),
      phrases: ["Set the temperature in \(.applicationName)", "Change the thermostat in \(.applicationName)"],
      shortTitle: "Set temperature",
      systemImageName: "thermometer.and.liquid.waves"
    )
    AppShortcut(
      intent: ThermostatModeIntent(),
      phrases: ["Set the thermostat to \(\.$mode) in \(.applicationName)", "Turn the \(.applicationName) thermostat to \(\.$mode)"],
      shortTitle: "Thermostat mode",
      systemImageName: "arrow.up.arrow.down"
    )
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
      intent: ArmCamerasIntent(),
      phrases: ["Arm the cameras in \(.applicationName)", "Arm \(.applicationName)"],
      shortTitle: "Arm cameras",
      systemImageName: "shield.lefthalf.filled"
    )
    AppShortcut(
      intent: DisarmCamerasIntent(),
      phrases: ["Disarm the cameras in \(.applicationName)", "Disarm \(.applicationName)"],
      shortTitle: "Disarm cameras",
      systemImageName: "shield.slash"
    )
    AppShortcut(
      intent: SnoozeCameraAlertsIntent(),
      phrases: ["Snooze camera alerts in \(.applicationName)", "Snooze \(.applicationName) alerts"],
      shortTitle: "Snooze alerts",
      systemImageName: "bell.slash"
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
