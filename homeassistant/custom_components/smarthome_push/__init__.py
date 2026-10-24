"""Smart Home app push: Home Assistant alerts sent straight to Apple for the Smart Home iPhone app.

The app posts its APNs device token to /api/smarthome_push/devices; `notify.smart_home_app` sends to every
registered phone. No relay in between: Home Assistant talks to Apple with the team's .p8 key.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from aiohttp import web
import voluptuous as vol

from homeassistant.components.http import HomeAssistantView
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_NAME, Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers import discovery
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .apns import Apns
from .const import CONF_BUNDLE_ID, CONF_KEY, CONF_KEY_ID, CONF_SANDBOX, CONF_TEAM_ID, DOMAIN

TOKEN = vol.Match(r"^[0-9a-fA-F]{32,200}$")


@dataclass
class PushData:
    """What the notify service and the view share."""

    apns: Apns
    devices: dict[str, dict[str, Any]]  # token -> {name, registered_at}
    store: Store[dict[str, dict[str, Any]]]

    def save(self) -> None:
        """Persist the device list soon."""
        self.store.async_delay_save(lambda: self.devices, 2)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Load the phones, take registrations, offer notify.smart_home_app."""
    store: Store[dict[str, dict[str, Any]]] = Store(hass, 1, f"{DOMAIN}.devices")
    data = entry.data
    hass.data[DOMAIN] = PushData(
        Apns(hass, data[CONF_TEAM_ID], data[CONF_KEY_ID], data[CONF_KEY], data[CONF_BUNDLE_ID], data[CONF_SANDBOX]),
        await store.async_load() or {},
        store,
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
