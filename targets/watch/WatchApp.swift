import SwiftUI

// Apple Watch app: camera snapshots (doorbell first), lights and switches, scenes. Talks to Home Assistant's
// REST API directly with the URL + token the iPhone app hands over (_shared/WatchSync.swift).
// ponytail: refreshes when opened and on pull-down; no live updates while it's open.

struct WState: Decodable, Identifiable {
  let entity_id: String
  let state: String
  let attributes: Attributes

  struct Attributes: Decodable {
    let friendly_name: String?
    let entity_picture: String?
    let snapshot_of: String?
    let proxy_slug: String?
    let camera_type: String?
  }

  var id: String { entity_id }
  var domain: String { String(entity_id.split(separator: ".")[0]) }
  var name: String { attributes.friendly_name ?? entity_id }
  var isOn: Bool { state == "on" }
  var unavailable: Bool { state == "unavailable" || state == "unknown" }

  var symbol: String {
    switch domain {
    case "light": "lightbulb.fill"
    case "fan": "fan.fill"
    case "scene": "sparkles"
    case "script": "play.fill"
    default: "power"
    }
  }
}

@MainActor
final class Home: ObservableObject {
  @Published var creds = Keychain.load()
  @Published var states: [WState] = []
  @Published var error: String?
  @Published var loading = false

  init() {
    NotificationCenter.default.addObserver(forName: .watchCreds, object: nil, queue: .main) { [weak self] note in
      MainActor.assumeIsolated {
        self?.creds = note.object as? WatchCreds
        Task { await self?.refresh() }
      }
    }
  }

  private func request(_ path: String, body: [String: Any]? = nil) async throws -> Data {
    guard let c = creds, let url = URL(string: c.url + path) else { throw URLError(.userAuthenticationRequired) }
    var req = URLRequest(url: url, timeoutInterval: 10)
    req.setValue("Bearer \(c.token)", forHTTPHeaderField: "Authorization")
    if let body {
      req.httpMethod = "POST"
      req.setValue("application/json", forHTTPHeaderField: "Content-Type")
      req.httpBody = try JSONSerialization.data(withJSONObject: body)
    }
    let (data, res) = try await URLSession.shared.data(for: req)
    guard (res as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
    return data
  }

  func refresh() async {
    guard creds != nil else { return WatchSync.shared.ask() }
    loading = true
    defer { loading = false }
    do {
      states = try JSONDecoder().decode([WState].self, from: await request("/api/states"))
        .sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
      error = nil
    } catch {
      self.error = "Can't reach Home Assistant. The watch needs your iPhone nearby, on home Wi-Fi."
    }
  }

  func call(_ domain: String, _ service: String, _ entity: String) async {
    _ = try? await request("/api/services/\(domain)/\(service)", body: ["entity_id": entity])
    await refresh()
  }

  /// The phone's Home favourites. When there are any, each section shows only those, in that order.
  private func pinned(_ list: [WState]) -> [WState] {
    let favs = UserDefaults.standard.stringArray(forKey: "favourites") ?? []
    let mine = favs.compactMap { id in list.first { $0.entity_id == id } }
    return favs.isEmpty ? list : mine
  }

  var cameras: [WState] {
    let doorbells = Set(states.filter { $0.attributes.camera_type == "doorbell" }.compactMap(\.attributes.proxy_slug))
    return pinned(states.filter { $0.attributes.snapshot_of != nil }
      .sorted { doorbells.contains($0.attributes.snapshot_of!) && !doorbells.contains($1.attributes.snapshot_of!) })
  }

  var devices: [WState] {
    pinned(states.filter {
      ["light", "switch", "fan", "input_boolean"].contains($0.domain)
        && !$0.entity_id.hasPrefix("switch.blink_proxy_") && !$0.entity_id.hasSuffix("_motion_detection")
    })
  }

  var scenes: [WState] { pinned(states.filter { $0.domain == "scene" || $0.domain == "script" }) }

  func picture(_ camera: WState) -> URL? {
    guard let c = creds, let p = camera.attributes.entity_picture else { return nil }
    return URL(string: c.url + p)
  }
}

@main
struct SmartHomeWatchApp: App {
  @StateObject private var home = Home()

  init() { WatchSync.shared.start() }

  var body: some Scene {
    WindowGroup { ContentView().environmentObject(home) }
  }
}

struct ContentView: View {
  @EnvironmentObject private var home: Home
  @Environment(\.scenePhase) private var phase

  var body: some View {
    NavigationStack {
      List {
        if home.creds == nil {
          Text("Open Smart Home on your iPhone to connect the watch.").font(.footnote)
        }
        if let error = home.error {
          Label(error, systemImage: "house.slash").font(.footnote).foregroundStyle(.secondary)
        }
        if !home.cameras.isEmpty {
          Section("Cameras") {
            ForEach(home.cameras) { c in
              NavigationLink { CameraView(camera: c) } label: { Snapshot(camera: c) }
            }
          }
        }
        if !home.devices.isEmpty {
          Section("Devices") {
            ForEach(home.devices) { d in
              Button {
                Task { await home.call(d.domain, "toggle", d.entity_id) }
              } label: {
                HStack {
                  Image(systemName: d.symbol).foregroundStyle(d.isOn ? .yellow : .secondary)
                  VStack(alignment: .leading) {
                    Text(d.name).lineLimit(1)
                    Text(d.unavailable ? "Unavailable" : d.isOn ? "On" : "Off").font(.caption2).foregroundStyle(.secondary)
                  }
                }
              }
              .disabled(d.unavailable)
            }
          }
        }
        if !home.scenes.isEmpty {
          Section("Scenes") {
            ForEach(home.scenes) { s in
              Button {
                Task { await home.call(s.domain, "turn_on", s.entity_id) }
              } label: {
                Label(s.name, systemImage: s.symbol)
              }
            }
          }
        }
      }
      .navigationTitle("Home")
      .refreshable { await home.refresh() }
      .overlay { if home.loading && home.states.isEmpty { ProgressView() } }
    }
    .task(id: phase) { if phase == .active { await home.refresh() } }
  }
}

struct Snapshot: View {
  @EnvironmentObject private var home: Home
  let camera: WState

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      AsyncImage(url: home.picture(camera)) { image in
        image.resizable().aspectRatio(16 / 9, contentMode: .fit)
      } placeholder: {
        Color.gray.opacity(0.2).aspectRatio(16 / 9, contentMode: .fit)
      }
      .clipShape(RoundedRectangle(cornerRadius: 8))
      Text(camera.name).font(.caption).lineLimit(1)
    }
  }
}

struct CameraView: View {
  @EnvironmentObject private var home: Home
  let camera: WState
  @State private var busy = false

  var body: some View {
    let current = home.states.first { $0.entity_id == camera.entity_id } ?? camera
    ScrollView {
      VStack(spacing: 8) {
        Snapshot(camera: current)
        Button(busy ? "Taking snapshot…" : "New snapshot") {
          busy = true
          Task {
            // camera.blink_proxy_<slug> → button.blink_proxy_<slug>_refresh_snapshot
            await home.call("button", "press", "button.\(camera.entity_id.split(separator: ".")[1])_refresh_snapshot")
            try? await Task.sleep(for: .seconds(6))
            await home.refresh()
            busy = false
          }
        }
        .disabled(busy)
        Text("Live view is on your iPhone.").font(.caption2).foregroundStyle(.secondary)
      }
    }
    .navigationTitle(camera.name)
  }
}
