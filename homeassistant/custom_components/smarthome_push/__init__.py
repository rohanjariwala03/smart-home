"""Smart Home app push: Home Assistant alerts sent straight to Apple for the Smart Home iPhone app.

The app posts its APNs device token to /api/smarthome_push/devices; `notify.smart_home_app` sends to every
registered phone. No relay in between: Home Assistant talks to Apple with the team's .p8 key.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any

from aiohttp import web
import voluptuous as vol

from homeassistant.components.http import HomeAssistantView
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_NAME, Platform
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers import discovery
import homeassistant.helpers.config_validation as cv
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .apns import Apns
from .const import CONF_BUNDLE_ID, CONF_KEY, CONF_KEY_ID, CONF_SANDBOX, CONF_TEAM_ID, DOMAIN

TOKEN = vol.Match(r"^[0-9a-fA-F]{32,200}$")
SNOOZED = "snoozed"  # kept in the devices store, next to the tokens


@dataclass
class PushData:
    """What the notify service and the view share."""

    apns: Apns
    devices: dict[str, dict[str, Any]]  # token -> {name, registered_at}
    store: Store[dict[str, dict[str, Any]]]
    snoozed: dict[str, str] = field(default_factory=dict)  # alert tag or group -> until (ISO time)

    def save(self) -> None:
        """Persist the devices and snoozes soon."""
        self.store.async_delay_save(lambda: {**self.devices, SNOOZED: self.snoozed}, 2)

    def is_snoozed(self, *keys: str | None) -> bool:
        """Whether alerts with this tag or group are held back right now."""
        now = dt_util.utcnow().isoformat()
        return any(key and self.snoozed.get(key, "") > now for key in keys)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Load the phones, take registrations, offer notify.smart_home_app."""
    store: Store[dict[str, dict[str, Any]]] = Store(hass, 1, f"{DOMAIN}.devices")
    data = entry.data
    saved = await store.async_load() or {}
    snoozed = saved.pop(SNOOZED, {})
    push = hass.data[DOMAIN] = PushData(
        Apns(hass, data[CONF_TEAM_ID], data[CONF_KEY_ID], data[CONF_KEY], data[CONF_BUNDLE_ID], data[CONF_SANDBOX]),
        saved,
        store,
        snoozed,
    )

    async def snooze(call: ServiceCall) -> None:
        """Hold back alerts with this tag (one camera) or group ("motion": every camera) for a while; 0 ends it."""
        key, minutes = call.data["key"], call.data["minutes"]
        if minutes:
            push.snoozed[key] = (dt_util.utcnow() + timedelta(minutes=minutes)).isoformat()
        else:
            push.snoozed.pop(key, None)
        push.save()

    hass.services.async_register(
        DOMAIN,
        "snooze",
        snooze,
        vol.Schema({vol.Required("key"): cv.string, vol.Required("minutes"): vol.All(int, vol.Range(0, 24 * 60))}),
    )
    hass.http.register_view(DevicesView())
    # A legacy notify platform: it takes `data` (picture, url, actions), like the companion app's.
    hass.async_create_task(
        discovery.async_load_platform(hass, Platform.NOTIFY, DOMAIN, {CONF_NAME: "smart_home_app"}, {})
    )
    return True


class DevicesView(HomeAssistantView):
    """POST {token, name}: the app registers (again on every launch; tokens can change)."""

    url = "/api/smarthome_push/devices"
    name = "api:smarthome_push:devices"

    async def post(self, request: web.Request) -> web.Response:
        """Register a phone."""
        hass: HomeAssistant = request.app["hass"]
        push: PushData | None = hass.data.get(DOMAIN)
        if push is None:
            return self.json_message("Smart Home app push is not set up", 503)
        try:
            body = await request.json()
            token = TOKEN(str(body["token"])).lower()
            name = str(body.get("name") or "iPhone")[:60]
        except (ValueError, KeyError, vol.Invalid):
            return self.json_message("Expected {token, name}", 400)
        push.devices[token] = {"name": name, "registered_at": dt_util.utcnow().isoformat()}
        push.save()
        return self.json({"registered": True, "devices": len(push.devices)})
