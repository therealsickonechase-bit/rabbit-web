#!/bin/bash
# Runs on a Google Cloud test VM at every boot (as root). It downloads the PUBLISHED Maxwell Core release exactly as a user would, installs it, and prints
# lines starting "MC-TEST:" to the serial console, ending with "MC-TEST-RESULT: PASS" or "FAIL". Phase 1 installs and reboots; phase 2 proves it came back by itself.
exec > >(tee /dev/ttyS0) 2>&1
set -u
P() { echo "MC-TEST: $*"; }
FAIL=0
ok() { if [ "$1" = 0 ]; then P "PASS  $2"; else P "FAIL  $2"; FAIL=1; fi; }
MODE="$(curl -fsS -H 'Metadata-Flavor: Google' http://metadata.google.internal/computeMetadata/v1/instance/attributes/mc-mode 2>/dev/null || echo linux)"
wait_verified() {
  for i in $(seq 1 90); do
    if curl -fsS -m 5 http://127.0.0.1:8646/api/summary 2>/dev/null | grep -q '"verified":true'; then return 0; fi
    sleep 2
  done
  return 1
}

if [ ! -f /var/lib/mc-test-phase1 ]; then
  P "PHASE 1 on $(uname -m) $(. /etc/os-release; echo "$PRETTY_NAME") kernel $(uname -r), init=$(cat /proc/1/comm), mode=$MODE"
  export DEBIAN_FRONTEND=noninteractive
  apt-get -o DPkg::Lock::Timeout=120 update -qq >/dev/null 2>&1
  apt-get -o DPkg::Lock::Timeout=120 install -y -qq curl unzip xz-utils sudo ca-certificates >/dev/null 2>&1
  cd /tmp || exit 1
  curl -fsSL https://rabbitsoftware.io/downloads/maxwell-core-latest.json -o latest.json; ok $? "release pointer downloaded from rabbitsoftware.io"
  VER="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' latest.json)"; FILE="$(sed -n 's/.*"file": *"\([^"]*\)".*/\1/p' latest.json)"; SHA="$(sed -n 's/.*"sha256": *"\([^"]*\)".*/\1/p' latest.json)"
  P "release $VER ($FILE)"
  curl -fsSLO "https://rabbitsoftware.io/downloads/$FILE"; ok $? "zip downloaded"
  echo "$SHA  $FILE" | sha256sum -c - >/dev/null 2>&1; ok $? "zip matches the signed checksum"
  unzip -q "$FILE"; cd "maxwell-core-$VER" || exit 1
  if [ "$MODE" = pi ]; then
    bash platforms/raspberry-pi/setup-pi.sh --force --install-node --name gc-test-pi; ok $? "Raspberry Pi setup script (real Node.js download)"
  else
    bash platforms/linux/install.sh --install-node; ok $? "Linux installer (real Node.js download)"
  fi
  P "node $(node -v 2>&1) at $(command -v node)"
  systemctl is-active --quiet maxwell-core; ok $? "service is active"
  systemctl is-enabled --quiet maxwell-core; ok $? "service is enabled for boot"
  wait_verified; ok $? "dashboard reports a verified chain"
  out="$(timeout 120 maxwell-core verify 2>&1)"; echo "$out" | tail -2; echo "$out" | grep -q "All 16 blocks verify"; ok $? "maxwell-core verify checks all 16 blocks"
  echo "$out" | grep -q "same tip"; ok $? "tip matches the Google Cloud gateway"
  timeout 120 maxwell-core watch --once; ok $? "maxwell-core watch --once"
  timeout 120 maxwell-core update; r=$?; { [ $r = 0 ] || [ $r = 4 ]; }; ok $? "maxwell-core update reaches the signed release pointer (exit $r)"
  maxwell-cli getblockcount >/dev/null 2>&1; ok $? "maxwell-cli answers"
  [ "$(stat -c %U:%a /var/lib/maxwell)" = "maxwell:750" ]; ok $? "data folder is private to the service account"
  P "service runs as: $(ps -o user= -C node | head -1)"
  [ "$FAIL" = 0 ] && touch /var/lib/mc-test-phase1 && P "PHASE 1 done; rebooting to prove it starts by itself" && sync && reboot
  [ "$FAIL" = 0 ] || P "MC-TEST-RESULT: FAIL (phase 1)"
else
  P "PHASE 2 after reboot on $(uname -m): uptime $(cut -d' ' -f1 /proc/uptime)s"
  systemctl is-active --quiet maxwell-core; ok $? "service started by itself at boot"
  wait_verified; ok $? "verified chain again after reboot"
  out="$(timeout 120 maxwell-core verify 2>&1)"; rc=$?
  echo "$out" | tail -2
  if [ "$rc" = 124 ]; then
    P "FAIL  maxwell-core verify hung (killed after 120s); processes:"; ps -eo pid,user,etime,stat,args | grep -E 'node|sudo|run.sh|maxwell' | grep -v grep | cut -c1-160 | while read -r l; do P "  $l"; done
    P "journal:"; journalctl -u maxwell-core --no-pager -n 6 | cut -c1-180 | while read -r l; do P "  $l"; done
    FAIL=1
  fi
  if [ "$FAIL" = 0 ]; then P "MC-TEST-RESULT: PASS"; else P "MC-TEST-RESULT: FAIL (phase 2)"; fi
fi
