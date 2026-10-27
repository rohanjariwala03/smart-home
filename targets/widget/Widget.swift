import AppIntents
import SwiftUI
import WidgetKit

// Home-screen widget: tap a tile to toggle a device. Talks to Home Assistant's REST API
// directly from the extension, so the app doesn't need to be running.

// HA client, DeviceEntity and the intents live in _shared/Home.swift (also compiled into the app, for Siri).

// MARK: - Configuration

struct ChooseDevices: WidgetConfigurationIntent {
  static let title: LocalizedStringResource = "Choose devices"
  static let description = IntentDescription("Pick the devices and scenes to show. Leave empty to show your Home favourites.")

  @Parameter(title: "Devices") var devices: [DeviceEntity]?
}

// MARK: - Timeline

struct Entry: TimelineEntry {
  let date: Date
  let devices: [HAState]
  var error: String? = nil
}

struct Provider: AppIntentTimelineProvider {
  func placeholder(in context: Context) -> Entry { Entry(date: .now, devices: []) }

  func snapshot(for configuration: ChooseDevices, in context: Context) async -> Entry {
    await entry(configuration, context.family)
  }

  // ponytail: refreshes every 15 min and after each tap; changes made elsewhere (Alexa, the app) show up on the next refresh.
  func timeline(for configuration: ChooseDevices, in context: Context) async -> Timeline<Entry> {
    Timeline(entries: [await entry(configuration, context.family)], policy: .after(.now.addingTimeInterval(15 * 60)))
  }

  private func entry(_ configuration: ChooseDevices, _ family: WidgetFamily) async -> Entry {
    do {
      let all = try await HA.states()
      let picked = (configuration.devices ?? []).compactMap { d in all.first { $0.entity_id == d.id } }
      // Not configured: the app's Home favourites in their order (cameras aren't in `all`), else lights and switches.
      let favs = HA.favourites().compactMap { id in all.first { $0.entity_id == id } }
      let shown = !picked.isEmpty ? picked : !favs.isEmpty ? favs : all.filter { ["light", "switch"].contains($0.domain) }
      return Entry(date: .now, devices: Array(shown.prefix(family == .systemLarge ? 8 : 4)))
    } catch HAError.notSignedIn {
      return Entry(date: .now, devices: [], error: "Open Smart Home and connect to Home Assistant")
    } catch {
      return Entry(date: .now, devices: [], error: "Can't reach Home Assistant")
    }
  }
}

// MARK: - Views

struct DevicesView: View {
  let entry: Entry
  @Environment(\.widgetFamily) private var family

  var body: some View {
    if let error = entry.error {
      Label(error, systemImage: "house.slash")
        .font(.caption)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
    } else if entry.devices.isEmpty {
      Text("No devices yet").font(.caption).foregroundStyle(.secondary)
    } else if family == .accessoryCircular || family == .accessoryRectangular {
      LockScreenTile(device: entry.devices[0], round: family == .accessoryCircular)
    } else {
      let d = entry.devices
      Grid(horizontalSpacing: 8, verticalSpacing: 8) {
        ForEach(Array(stride(from: 0, to: d.count, by: 2)), id: \.self) { i in
          GridRow {
            Tile(device: d[i], compact: family == .systemSmall)
            if i + 1 < d.count {
              Tile(device: d[i + 1], compact: family == .systemSmall)
            } else {
              Color.clear
            }
          }
        }
      }
    }
  }
}

struct Tile: View {
  let device: HAState
  let compact: Bool

  var body: some View {
    Button(intent: ToggleIntent(device.entity_id)) {
      Group {
        if compact {
          VStack(alignment: .leading, spacing: 2) {
            icon
            Spacer(minLength: 0)
            Text(device.name).font(.caption2.weight(.semibold)).lineLimit(1)
          }
        } else {
          HStack(spacing: 8) {
            icon
            VStack(alignment: .leading, spacing: 0) {
              Text(device.name).font(.caption.weight(.semibold)).lineLimit(1)
              Text(device.status).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 0)
          }
        }
      }
      .padding(8)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
      .background(
        device.isOn ? AnyShapeStyle(device.tint.opacity(0.3)) : AnyShapeStyle(.fill.secondary),
        in: RoundedRectangle(cornerRadius: 14, style: .continuous)
      )
    }
    .buttonStyle(.plain)
    .disabled(device.unavailable)
    .opacity(device.unavailable ? 0.45 : 1)
  }

  private var icon: some View {
    Image(systemName: device.symbol)
      .font(.system(size: 15, weight: .semibold))
      .foregroundStyle(device.isOn ? device.tint : .secondary)
  }
}

// Lock Screen: one device, the first one picked.
struct LockScreenTile: View {
  let device: HAState
  let round: Bool

  var body: some View {
    Button(intent: ToggleIntent(device.entity_id)) {
      if round {
        ZStack {
          AccessoryWidgetBackground()
          Image(systemName: device.symbol).font(.title3.weight(.semibold)).opacity(device.isOn ? 1 : 0.5)
        }
      } else {
        HStack(spacing: 8) {
          Image(systemName: device.symbol).font(.title3.weight(.semibold)).opacity(device.isOn ? 1 : 0.5)
          VStack(alignment: .leading, spacing: 0) {
            Text(device.name).font(.headline).lineLimit(1)
            Text(device.status).font(.caption).lineLimit(1)
          }
          Spacer(minLength: 0)
        }
      }
    }
    .buttonStyle(.plain)
    .disabled(device.unavailable)
    .widgetAccentable()
    .accessibilityLabel("\(device.name), \(device.status)")
  }
}

// MARK: - Control Center

struct ChooseControlDevice: ControlConfigurationIntent {
  static let title: LocalizedStringResource = "Choose device"

  @Parameter(title: "Device") var device: DeviceEntity?
}

// Control Center can't run PowerIntent (a toggle needs a SetValueIntent), so this wraps it.
struct ControlPowerIntent: SetValueIntent {
  static let title: LocalizedStringResource = "Switch device"

  @Parameter(title: "Device") var device: DeviceEntity?
  @Parameter(title: "On") var value: Bool

  init() {}
  init(_ device: DeviceEntity?) { self.device = device }

  func perform() async throws -> some IntentResult {
    guard let device else { return .result() }
    try await HA.set(device.id, on: value)
    WidgetCenter.shared.reloadAllTimelines()
    return .result()
  }
}

struct ControlState {
  var device: DeviceEntity?
  var isOn = false
  var symbol = "power"
}

struct ControlProvider: AppIntentControlValueProvider {
  func previewValue(configuration: ChooseControlDevice) -> ControlState {
    ControlState(device: configuration.device)
  }

  func currentValue(configuration: ChooseControlDevice) async throws -> ControlState {
    guard let device = configuration.device else { return ControlState() }
    let s = try await HA.state(device.id)
    return ControlState(device: DeviceEntity(id: device.id, name: s.name), isOn: s.isOn, symbol: s.symbol)
  }
}

// Also goes on the Lock Screen in place of the torch or camera button.
struct DeviceControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    AppIntentControlConfiguration(kind: "DeviceControl", provider: ControlProvider()) { state in
      ControlWidgetToggle(state.device?.name ?? "Choose a device", isOn: state.isOn, action: ControlPowerIntent(state.device)) { on in
        Label(on ? "On" : "Off", systemImage: state.symbol)
      }
    }
    .displayName("Device")
    .description("Switch a light or switch from Control Center or the Lock Screen.")
    .promptsForUserConfiguration()
  }
}

// MARK: - Thermostat

struct ThermostatEntry: TimelineEntry {
  let date: Date
  let thermostat: HAClimate?
  var error: String? = nil
}

struct ThermostatProvider: TimelineProvider {
  func placeholder(in context: Context) -> ThermostatEntry { ThermostatEntry(date: .now, thermostat: nil) }

  func getSnapshot(in context: Context, completion: @escaping (ThermostatEntry) -> Void) {
    Task { completion(await entry()) }
  }

  // ponytail: refreshes every 15 min and after each − / + tap, like the devices widget.
  func getTimeline(in context: Context, completion: @escaping (Timeline<ThermostatEntry>) -> Void) {
    Task { completion(Timeline(entries: [await entry()], policy: .after(.now.addingTimeInterval(15 * 60)))) }
  }

  private func entry() async -> ThermostatEntry {
    do {
      guard let t = try await HA.thermostat() else { return ThermostatEntry(date: .now, thermostat: nil, error: "No thermostat in Home Assistant") }
      return ThermostatEntry(date: .now, thermostat: t)
    } catch HAError.notSignedIn {
      return ThermostatEntry(date: .now, thermostat: nil, error: "Open Smart Home and connect to Home Assistant")
    } catch {
      return ThermostatEntry(date: .now, thermostat: nil, error: "Can't reach Home Assistant")
    }
  }
}

private let navy = Color(red: 0.05, green: 0.11, blue: 0.16)
private let dim = Color(red: 0.62, green: 0.69, blue: 0.76)

struct ThermostatView: View {
  let entry: ThermostatEntry
  @Environment(\.widgetFamily) private var family

  var body: some View {
    if let t = entry.thermostat {
      switch family {
      case .accessoryCircular:
        Gauge(value: t.attributes.current_temperature ?? 0, in: (t.attributes.min_temp ?? 0)...(t.attributes.max_temp ?? 100)) {
          Image(systemName: t.symbol)
        } currentValueLabel: {
          Text(t.attributes.current_temperature.map { "\(Int($0.rounded()))°" } ?? "–")
        }
        .gaugeStyle(.accessoryCircular)
        .accessibilityLabel("\(deg(t.attributes.current_temperature)) inside, \(t.summary)")
      case .accessoryRectangular:
        VStack(alignment: .leading, spacing: 0) {
          Label("\(deg(t.attributes.current_temperature)) inside", systemImage: t.symbol).font(.headline)
          Text(t.summary).font(.caption)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      case .accessoryInline:
        Label("\(deg(t.attributes.current_temperature)) · \(t.doing)", systemImage: t.symbol)
      case .systemMedium:
        HStack(spacing: 16) {
          reading(t)
          if !t.off {
            VStack(spacing: 10) {
              if t.range {
                setPoint(t, key: "target_temp_low", label: "Heat", value: t.attributes.target_temp_low, color: .orange)
                setPoint(t, key: "target_temp_high", label: "Cool", value: t.attributes.target_temp_high, color: .blue)
              } else {
                setPoint(t, key: "", label: t.state == "cool" ? "Cool to" : "Heat to", value: t.attributes.temperature, color: t.state == "cool" ? .blue : .orange)
              }
            }
          }
        }
      default:
        VStack(alignment: .leading, spacing: 4) {
          reading(t)
          if !t.off, let target = t.target {
            HStack(spacing: 6) {
              step(t, key: "", warmer: false)
              Text(target).font(.subheadline.weight(.semibold)).monospacedDigit().minimumScaleFactor(0.6).lineLimit(1).frame(maxWidth: .infinity)
              step(t, key: "", warmer: true)
            }
          }
        }
      }
    } else {
      Label(entry.error ?? "Thermostat", systemImage: "thermometer.medium")
        .font(.caption)
        .foregroundStyle(dim)
        .multilineTextAlignment(.center)
    }
  }

  private func reading(_ t: HAClimate) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      Label(t.doing, systemImage: t.symbol)
        .font(.caption.weight(.semibold))
        .foregroundStyle(t.working ? t.tint : .white)
      Text(deg(t.attributes.current_temperature))
        .font(.system(size: 46, weight: .thin))
        .monospacedDigit()
        .minimumScaleFactor(0.5)
        .lineLimit(1)
        .foregroundStyle(.white)
      Spacer(minLength: 0)
      if let h = t.attributes.current_humidity {
        Label("\(Int(h))%", systemImage: "humidity.fill").font(.caption2).foregroundStyle(dim)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func setPoint(_ t: HAClimate, key: String, label: String, value: Double?, color: Color) -> some View {
    HStack(spacing: 8) {
      VStack(alignment: .leading, spacing: 0) {
        Text(label).font(.caption2.weight(.semibold)).foregroundStyle(color)
        Text(deg(value)).font(.title3.weight(.medium)).monospacedDigit().foregroundStyle(.white)
      }
      .frame(minWidth: 52, alignment: .leading)
      step(t, key: key, warmer: false)
      step(t, key: key, warmer: true)
    }
  }

  private func step(_ t: HAClimate, key: String, warmer: Bool) -> some View {
    Button(intent: NudgeThermostatIntent(t.entity_id, key: key, warmer: warmer)) {
      Image(systemName: warmer ? "plus" : "minus")
        .font(.system(size: 14, weight: .bold))
        .foregroundStyle(.white)
        .frame(width: 32, height: 32)
        .background(.white.opacity(0.15), in: Circle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(warmer ? "Warmer" : "Cooler")
  }
}

struct ThermostatWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "Thermostat", provider: ThermostatProvider()) { entry in
      ThermostatView(entry: entry)
        .containerBackground(for: .widget) { navy }
        .widgetURL(URL(string: "smarthome://devices?device=\(entry.thermostat?.entity_id ?? "")"))
    }
    .configurationDisplayName("Thermostat")
    .description("The temperature inside and what the thermostat is doing. Tap − or + to change it.")
    .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline])
  }
}

// MARK: - Widget

struct DevicesWidget: Widget {
  var body: some WidgetConfiguration {
    AppIntentConfiguration(kind: "Devices", intent: ChooseDevices.self, provider: Provider()) { entry in
      DevicesView(entry: entry).containerBackground(.fill.tertiary, for: .widget)
    }
    .configurationDisplayName("Devices")
    .description("Tap to switch lights and devices. Hold the widget › Edit Widget to choose which. On the Lock Screen it shows the first one.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryCircular, .accessoryRectangular])
  }
}

@main
struct SmartHomeWidgets: WidgetBundle {
  var body: some Widget {
    DevicesWidget()
    ThermostatWidget()
    DeviceControl()
  }
}
