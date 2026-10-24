"""notify.smart_home_app: alerts for the Smart Home iPhone app."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from homeassistant.components.notify import ATTR_DATA, ATTR_TARGET, ATTR_TITLE, BaseNotificationService
from homeassistant.core import HomeAssistant
from homeassistant.helpers.typing import ConfigType, DiscoveryInfoType

from .apns import GONE, image_url, payload
from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


async def async_get_service(
    hass: HomeAssistant, config: ConfigType, discovery_info: DiscoveryInfoType | None = None
) -> SmartHomeNotify | None:
    """Only through the config entry's discovery."""
    return SmartHomeNotify() if discovery_info is not None else None


class SmartHomeNotify(BaseNotificationService):
    """Sends to every registered phone, or the ones named in `target`."""

    async def async_send_message(self, message: str = "", **kwargs: Any) -> None:
        """Same call shape as the companion app's notify: title, message, data {image, url, group, tag, ...}."""
        push = self.hass.data[DOMAIN]
        data = kwargs.get(ATTR_DATA) or {}
        targets = kwargs.get(ATTR_TARGET)
        body = payload(message, kwargs.get(ATTR_TITLE), data, image_url(self.hass, data.get("image")))
        for token, device in list(push.devices.items()):
            if targets and device["name"] not in targets:
                continue
            try:
                status, reason = await push.apns.send(token, body, data.get("tag"))
            except httpx.HTTPError as err:
                _LOGGER.warning("Could not reach Apple to notify %s: %s", device["name"], err)
                continue
            if status == 200:
                continue
            if status == 410 or reason in GONE:
                _LOGGER.info("Dropping %s: Apple says %s", device["name"], reason or status)
                push.devices.pop(token, None)
                push.save()
            else:
                _LOGGER.warning("Apple refused the notification for %s: %s %s", device["name"], status, reason)
