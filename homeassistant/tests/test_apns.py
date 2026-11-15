"""Run: <venv with homeassistant>/bin/python -m pytest homeassistant/tests (from the repo root)."""

from pathlib import Path
import sys

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
import jwt
import pytest

sys.path.insert(0, str(Path(__file__).parents[1] / "custom_components"))
from smarthome_push.apns import ACTIVITY_MINUTES, activity_end, activity_start, check_key, payload  # noqa: E402


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


def test_snooze() -> None:
    """A tag or a group held back until its time; other alerts and expired snoozes go through."""
    from datetime import timedelta  # noqa: PLC0415

    from smarthome_push import PushData  # noqa: PLC0415

    from homeassistant.util import dt as dt_util  # noqa: PLC0415

    push = PushData(apns=None, devices={}, store=None)
    soon, past = dt_util.utcnow() + timedelta(minutes=5), dt_util.utcnow() - timedelta(minutes=5)
    push.snoozed = {"motion": soon.isoformat(), "old_tag": past.isoformat()}
    assert push.is_snoozed("cam_tag", "motion")
    assert not push.is_snoozed("old_tag", "health")
    assert not push.is_snoozed(None, None)


def test_doorbell_live_activity() -> None:
    """Start and end bodies match DoorbellAttributes in targets/widget/_shared/Doorbell.swift."""
    start = activity_start("Someone’s at the door", "Front Door", "smarthome://cameras?live=front_door", 1000)["aps"]
    assert start["event"] == "start"
    assert start["attributes-type"] == "DoorbellAttributes"
    assert start["attributes"] == {"camera": "Front Door", "url": "smarthome://cameras?live=front_door"}
    assert start["content-state"] == {"message": "Someone’s at the door"}
    assert start["stale-date"] == 1000 + ACTIVITY_MINUTES * 60
    assert "sound" not in start["alert"]  # the doorbell's normal alert makes the sound
    end = activity_end(2000)["aps"]
    assert (end["event"], end["dismissal-date"], end["timestamp"]) == ("end", 2000, 2000)
