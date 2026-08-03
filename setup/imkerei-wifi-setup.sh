#!/bin/bash
# Bereitet das WLAN-Modul vor und startet danach dauerhaft das
# WLAN-Einstellungen-Portal (imkerei_wifi_portal.py). Laeuft permanent,
# nicht nur beim Ersteinrichten - erreichbar unter http://<hostname>.local,
# egal ob gerade WLAN verbunden ist oder nicht. So laesst sich das WLAN
# jederzeit neu einrichten oder wechseln, nicht nur beim ersten Start.
set -u

PORTAL_SCRIPT="/opt/imkerei-wifi-setup/imkerei_wifi_portal.py"

if command -v rfkill >/dev/null; then
    rfkill unblock wifi || true
fi
if command -v nmcli >/dev/null; then
    nmcli radio wifi on || true
fi

# exec ersetzt den Shell-Prozess durch den Python-Server, damit systemd
# (Type=simple) den Portal-Prozess direkt als Haupt-PID verfolgt.
exec python3 "$PORTAL_SCRIPT"
