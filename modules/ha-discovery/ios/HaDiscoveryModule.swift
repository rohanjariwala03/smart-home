import ExpoModulesCore
import Network

// Home Assistant advertises _home-assistant._tcp over Bonjour (its zeroconf integration, on by default), with its
// name and address in the TXT record. The app's Info.plist lists the service type (NSBonjourServices), or iOS
// refuses to browse.
public class HaDiscoveryModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HaDiscovery")

    AsyncFunction("find") { (seconds: Double) async -> [[String: String]] in
      await Finder().run(seconds: seconds)
    }
  }
}

private final class Finder: @unchecked Sendable {
  // Everything below runs on this queue.
  private let queue = DispatchQueue(label: "ha-discovery")
  private var found: [String: [String: String]] = [:]

  func run(seconds: Double) async -> [[String: String]] {
    await withCheckedContinuation { done in
      let browser = NWBrowser(for: .bonjourWithTXTRecord(type: "_home-assistant._tcp", domain: nil), using: .tcp)
      browser.browseResultsChangedHandler = { results, _ in
        for result in results {
          guard case let .service(name, _, _, _) = result.endpoint,
                case let .bonjour(record) = result.metadata else { continue }
          let txt = record.dictionary
          // ponytail: an HA that can't work out its own address sends none; resolve the service's host if that shows up.
          guard let url = [txt["internal_url"], txt["base_url"]].compactMap({ $0 }).first(where: { !$0.isEmpty }) else { continue }
          self.found[txt["uuid"] ?? name] = ["name": txt["location_name"] ?? name, "url": url, "version": txt["version"] ?? ""]
        }
      }
      browser.start(queue: queue)
      queue.asyncAfter(deadline: .now() + seconds) {
        browser.cancel()
        done.resume(returning: Array(self.found.values))
      }
    }
  }
}
