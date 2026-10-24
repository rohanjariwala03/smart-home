"""Config flow: the Apple team's push key (.p8) and the app it sends to."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult
from homeassistant.helpers.selector import TextSelector, TextSelectorConfig

from .apns import check_key
from .const import CONF_BUNDLE_ID, CONF_KEY, CONF_KEY_ID, CONF_SANDBOX, CONF_TEAM_ID, DEFAULT_BUNDLE_ID, DOMAIN


class SmartHomePushConfigFlow(ConfigFlow, domain=DOMAIN):
    """One entry: the key and the app's bundle id."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Ask for the key."""
        errors: dict[str, str] = {}
        if user_input is not None:
            key = user_input[CONF_KEY].strip()
            try:
                check_key(key)
            except Exception:  # noqa: BLE001 - PyJWT/cryptography raise several kinds for a bad key
                errors[CONF_KEY] = "bad_key"
            else:
                return self.async_create_entry(title="Smart Home app", data={**user_input, CONF_KEY: key})
        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_TEAM_ID): vol.All(str, vol.Match(r"^[A-Z0-9]{10}$")),
                    vol.Required(CONF_KEY_ID): vol.All(str, vol.Match(r"^[A-Z0-9]{10}$")),
                    vol.Required(CONF_KEY): TextSelector(TextSelectorConfig(multiline=True)),
                    vol.Required(CONF_BUNDLE_ID, default=DEFAULT_BUNDLE_ID): str,
                    vol.Required(CONF_SANDBOX, default=True): bool,
                }
            ),
            errors=errors,
        )
