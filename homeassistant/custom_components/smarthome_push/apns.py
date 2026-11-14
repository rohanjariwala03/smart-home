"""Apple Push Notification service: token auth (ES256 JWT) over HTTP/2, and the alert payload."""

from __future__ import annotations

from datetime import timedelta
import time
from typing import Any
from urllib.parse import urlsplit

import jwt

from homeassistant.components.http.auth import async_sign_path
from homeassistant.core import HomeAssistant
from homeassistant.helpers.httpx_client import get_async_client
from homeassistant.helpers.network import get_url
from homeassistant.util.ssl import SSL_ALPN_HTTP11_HTTP2

PRODUCTION = "https://api.push.apple.com"
SANDBOX = "https://api.sandbox.push.apple.com"  # builds signed for development (Xcode) get sandbox tokens
JWT_SECONDS = 45 * 60  # Apple wants a token between 20 and 60 minutes old
IMAGE_TTL = timedelta(days=2)
GONE = {"BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"}  # the token will never work again
ACTIVITY_MINUTES = 3  # how long the doorbell's Live Activity stays up


def payload(message: str, title: str | None, data: dict[str, Any] | None, image: str | None) -> dict[str, Any]:
    """The APNs body for a Home Assistant-style notify call (same `data` keys the companion app reads)."""
    data = data or {}
    aps: dict[str, Any] = {"alert": {"body": message} | ({"title": title} if title else {}), "sound": "default"}
    if group := data.get("group"):
        aps["thread-id"] = str(group)
    if level := (data.get("push") or {}).get("interruption-level"):
        aps["interruption-level"] = level
    live = next((a.get("uri") for a in data.get("actions") or [] if a.get("action") == "URI"), None)
    if live:
        aps["category"] = "camera"  # the app registers this category with its Live view button
    if image:
        aps["mutable-content"] = 1  # lets the app's notification extension attach the picture
    extra = {"url": data.get("url"), "live": live, "image": image, "tag": data.get("tag"), "group": group}
    # expo-notifications hands the app the "body" dictionary as the notification's data.
    return {"aps": aps, "body": {k: v for k, v in extra.items() if v}}


def image_url(hass: HomeAssistant, image: str | None) -> str | None:
    """An address the phone can fetch without signing in: Home Assistant paths get signed."""
    if not image:
        return None
    if image.startswith("/"):
        if "authSig=" not in image:
            image = async_sign_path(hass, image, IMAGE_TTL, use_content_user=True)
        image = get_url(hass, allow_external=False) + image
    return image if urlsplit(image).scheme in ("http", "https") else None


class Apns:
    """Sends to Apple with a cached provider token."""

    def __init__(self, hass: HomeAssistant, team_id: str, key_id: str, key: str, topic: str, sandbox: bool) -> None:
        """Initialize."""
        self.hass = hass
        self.team_id, self.key_id, self.key, self.topic = team_id, key_id, key, topic
        self.host = SANDBOX if sandbox else PRODUCTION
        self._token = ""
        self._token_at = 0.0

    def _jwt(self) -> str:
        now = time.time()
        if now - self._token_at > JWT_SECONDS:
            self._token = jwt.encode(
                {"iss": self.team_id, "iat": int(now)}, self.key, algorithm="ES256", headers={"kid": self.key_id}
            )
            self._token_at = now
        return self._token

    async def send(
        self, device: str, body: dict[str, Any], collapse: str | None = None, live_activity: bool = False
    ) -> tuple[int, str]:
        """(status, Apple's reason); 200 means accepted. `live_activity`: a Live Activity token and body."""
        headers = {
            "authorization": f"bearer {self._jwt()}",
            "apns-topic": f"{self.topic}.push-type.liveactivity" if live_activity else self.topic,
            "apns-push-type": "liveactivity" if live_activity else "alert",
            "apns-priority": "10",
        }
        if collapse:
            headers["apns-collapse-id"] = collapse[:64]  # a newer alert with the same tag replaces the older one
        client = get_async_client(self.hass, alpn_protocols=SSL_ALPN_HTTP11_HTTP2)
        resp = await client.post(f"{self.host}/3/device/{device}", json=body, headers=headers, timeout=15)
        reason = "" if resp.status_code == 200 else (resp.json() if resp.content else {}).get("reason", "")
        return resp.status_code, reason


def activity_start(message: str, camera: str, url: str, now: int) -> dict[str, Any]:
    """Starts the app's doorbell Live Activity (DoorbellAttributes in targets/widget/_shared/Doorbell.swift).

    No sound: the doorbell's normal alert, sent alongside, already makes one.
    """
    return {
        "aps": {
            "timestamp": now,
            "event": "start",
            "content-state": {"message": message},
            "attributes-type": "DoorbellAttributes",
            "attributes": {"camera": camera, "url": url},
            "alert": {"title": camera, "body": message},
            "stale-date": now + ACTIVITY_MINUTES * 60,
        }
    }


def activity_end(now: int) -> dict[str, Any]:
    """Ends a doorbell Live Activity and takes it off the Lock Screen."""
    return {
        "aps": {
            "timestamp": now,
            "event": "end",
            "content-state": {"message": "Someone was at the door"},
            "dismissal-date": now,
        }
    }


def check_key(key: str) -> None:
    """Raises ValueError when the .p8 text isn't an EC private key."""
    jwt.encode({"iss": "check", "iat": int(time.time())}, key, algorithm="ES256")
