#!/bin/sh
# Runs every 2 minutes (LaunchAgent com.smarthome.hub-watchdog). Keeps the Home Assistant VM reachable and copies
# HA's newest backup to the Mac. Only acts on the home network; when the Mac sleeps, launchd doesn't run it.
# Your setup goes in scripts/hub-watchdog.env (git-ignored), e.g.:
#   VM="Home Assistant"          # UTM VM name or id
#   HA=http://192.168.1.50       # Home Assistant's address
#   GATEWAY=192.168.1.1          # your router: the script only acts on the home network
. "$(dirname "$0")/hub-watchdog.env" || exit 1
U=/opt/homebrew/bin/utmctl
DIR="$HOME/Library/Application Support/SmartHomeHub"
BACKUPS="$HOME/Home Assistant Backups"
KEEP=7
mkdir -p "$DIR" "$BACKUPS"
log() { echo "$(date '+%F %T') $*" >> "$DIR/watchdog.log"; }
notify() { osascript -e "display notification \"$1\" with title \"Home Assistant\"" >/dev/null 2>&1; }

route -n get default 2>/dev/null | grep -q "gateway: $GATEWAY\$" || exit 0

if [ "$($U status "$VM" 2>/dev/null)" != started ]; then
  log "VM not running, starting it"
  open -ga UTM; sleep 10; $U start "$VM"
  exit 0
fi

if [ "$(curl -s -m 5 -o /dev/null -w '%{http_code}' "$HA/manifest.json")" = 000 ]; then
  n=$(($(cat "$DIR/fails" 2>/dev/null || echo 0) + 1)); echo $n > "$DIR/fails"
  last=$(cat "$DIR/restarted" 2>/dev/null || echo 0)
  # 3 misses in a row (~6 min, enough for a boot or Wi-Fi reconnect), and at most one restart per 20 minutes.
  if [ $n -ge 3 ] && [ $(($(date +%s) - last)) -gt 1200 ]; then
    log "unreachable for $n checks, restarting VM"
    notify "Hub unreachable, restarting it"
    date +%s > "$DIR/restarted"; echo 0 > "$DIR/fails"
    $U stop "$VM" --force; sleep 5; $U start "$VM"
  fi
  exit 0
fi
echo 0 > "$DIR/fails"

# Copy HA's newest backup once (the pull takes several minutes over the guest agent).
$U exec "$VM" --cmd /bin/sh -c 'ls -t /mnt/data/supervisor/backup/*.tar | head -1 > /tmp/latest-backup' || exit 0
src=$($U file pull "$VM" /tmp/latest-backup 2>/dev/null)
name=$(basename "$src")
case "$name" in *.tar) ;; *) exit 0 ;; esac
[ -f "$BACKUPS/$name" ] && exit 0
log "copying $name"
if $U file pull "$VM" "$src" > "$BACKUPS/.$name.part" && tar tf "$BACKUPS/.$name.part" >/dev/null 2>&1; then
  mv "$BACKUPS/.$name.part" "$BACKUPS/$name"
  ls -t "$BACKUPS"/*.tar | tail -n +$((KEEP + 1)) | while read -r old; do rm -f "$old"; done
  log "copied $name"
else
  rm -f "$BACKUPS/.$name.part"; log "copy of $name failed"
fi
