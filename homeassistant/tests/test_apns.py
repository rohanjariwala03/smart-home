"""Run: <venv with homeassistant>/bin/python -m pytest homeassistant/tests (from the repo root)."""

from pathlib import Path
import sys

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
import jwt
import pytest

sys.path.insert(0, str(Path(__file__).parents[1] / "custom_components"))
from smarthome_push.apns import check_key, payload  # noqa: E402


def test_payload_matches_companion_app_data() -> None:
    """The same notify `data` the app's automations send to the companion app."""
    body = payload(
        "Motion detected",
        "Outdoor 4",
        {
            "group": "motion",
            "url": "smarthome://cameras?live=outdoor",
            "actions": [{"action": "URI", "title": "Live view", "uri": "smarthome://cameras?live=outdoor"}],
            "push": {"interruption-level": "time-sensitive"},
        },
        "http://ha.local/api/camera_proxy/camera.x?authSig=y",
    )
    assert body["aps"] == {
        "alert": {"body": "Motion detected", "title": "Outdoor 4"},
        "sound": "default",
        "thread-id": "motion",
        "interruption-level": "time-sensitive",
        "category": "camera",
        "mutable-content": 1,
    }
    assert body["body"]["live"] == body["body"]["url"]
    assert payload("Hi", None, None, None) == {"aps": {"alert": {"body": "Hi"}, "sound": "default"}, "body": {}}


def test_key_check() -> None:
    """A real EC P-256 key signs; anything else is refused."""
    key = ec.generate_private_key(ec.SECP256R1()).private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    )
    check_key(key.decode())
    token = jwt.encode({"iss": "T"}, key, algorithm="ES256", headers={"kid": "K"})
    assert jwt.get_unverified_header(token)["kid"] == "K"
    with pytest.raises(Exception):  # noqa: B017
        check_key("not a key")
