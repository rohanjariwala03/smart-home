import UserNotifications

/// Attaches the picture Home Assistant sends with an alert (`body.image`: a signed Home Assistant address on the
/// home network), so the alert shows the snapshot like the companion app's do. Without it, or away from home,
/// the alert arrives as text.
class NotificationService: UNNotificationServiceExtension {
  private var handler: ((UNNotificationContent) -> Void)?
  private var content: UNMutableNotificationContent?

  override func didReceive(
    _ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    handler = contentHandler
    content = request.content.mutableCopy() as? UNMutableNotificationContent
    guard let content,
      let body = request.content.userInfo["body"] as? [String: Any],
      let address = body["image"] as? String, let url = URL(string: address)
    else { return contentHandler(request.content) }

    URLSession.shared.downloadTask(with: url) { file, response, _ in
      defer { contentHandler(content) }
      guard let file, (response as? HTTPURLResponse)?.statusCode == 200 else { return }
      let jpeg = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".jpg")
      guard (try? FileManager.default.moveItem(at: file, to: jpeg)) != nil,
        let picture = try? UNNotificationAttachment(identifier: "image", url: jpeg)
      else { return }
      content.attachments = [picture]
    }.resume()
  }

  /// Out of time (about 30 s): show the text alone.
  override func serviceExtensionTimeWillExpire() {
    if let handler, let content { handler(content) }
  }
}
