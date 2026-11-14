import ActivityKit
import Foundation

// The doorbell's Live Activity: "Someone's at the door" on the Lock Screen and in the Dynamic Island, tap for live
// view. Home Assistant starts it with a push when the doorbell rings (push-to-start), and ends it a few minutes later
// with a push to the activity's own token (homeassistant/custom_components/smarthome_push). The app's only job is to
// hand Home Assistant those two tokens; iOS wakes the app in the background to deliver the second one.
// The widget extension draws it (DoorbellLiveActivity in Widget.swift); this file is compiled into both.

struct DoorbellAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    var message: String
  }

  var camera: String
  /// smarthome://cameras?live=<camera>: opens live view.
  var url: String
}

enum DoorbellActivity {
  /// Called at launch (AppDelegate, via plugins/with-app-shortcuts.js).
  static func start() {
    Task {
      for await token in Activity<DoorbellAttributes>.pushToStartTokenUpdates {
        await register(["start_token": hex(token)])
      }
    }
    Task {
      for await activity in Activity<DoorbellAttributes>.activityUpdates {
        Task {
          for await token in activity.pushTokenUpdates {
            await register(["activity_token": hex(token)])
          }
        }
      }
    }
  }

  private static func hex(_ data: Data) -> String { data.map { String(format: "%02x", $0) }.joined() }

  // Fails quietly when Home Assistant's push integration isn't set up (or is an older one without this endpoint):
  // the doorbell then just alerts as before.
  private static func register(_ body: [String: String]) async {
    _ = try? await HA.request("/api/smarthome_push/activities", body: body)
  }
}
