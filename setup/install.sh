#!/bin/bash
# Komplette Ersteinrichtung der BeeTown-App auf einem frisch installierten
# Raspberry Pi OS Lite (Core). Fuehrt alles aus, was in einer manuellen
# Ersteinrichtung noetig waere: WLAN-Modul vorbereiten, App-Verzeichnis samt
# Dienst-Benutzer einrichten, Setup-/WLAN-Einstellungen-Portal installieren
# (dauerhaft), taeglichen Backup-Timer installieren, Hostname setzen und
# neu starten.
#
# Nutzung:
#   1. Diesen kompletten "setup"-Ordner per FTP/SFTP/FileZilla auf den Pi
#      kopieren, z. B. nach /opt/setup.
#   2. sudo bash /opt/setup/install.sh
#
# Der Hostname wird fest auf "beetown" gesetzt, am Ende startet der Pi
# automatisch neu (fuer die Hostnamen-Aenderung erforderlich).
#
# Mehrfach ausfuehrbar (idempotent) - z. B. nach einem Datei-Update einfach
# erneut laufen lassen.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
    echo "Bitte mit sudo ausfuehren: sudo bash $0"
    exit 1
fi

# Dieser Ordner ist NUR fuer Raspberry Pi OS gedacht (setzt raspi-config,
# WLAN per NetworkManager, Boot-Banner in /etc/issue etc. voraus) und
# startet mehrere Dienste auf den Ports 80/8080/8081. Auf einem normalen
# Debian-/Linux-Server wuerde das u. a. einen ggf. aktiven
# wpa_supplicant.service deaktivieren und Port 80 belegen - daher hier
# hart abbrechen, BEVOR irgendetwas am System veraendert wird.
if ! grep -qi "raspberry pi" /proc/device-tree/model 2>/dev/null; then
    echo "FEHLER: Dies ist kein Raspberry Pi (/proc/device-tree/model passt nicht)."
    echo "Dieses Skript ist nur fuer Raspberry Pi OS (Lite/Core) gedacht."
    echo "Fuer einen normalen Debian-/Linux-Server bitte stattdessen dem"
    echo "Abschnitt 'Bereitstellung auf einem allgemeinen Linux Server' in"
    echo "der README.md folgen (manuelle Einrichtung, kein install.sh)."
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OWNER="${SUDO_USER:-}"
NEW_HOSTNAME="beetown"

log() { echo; echo "==> $*"; }

# ---------------------------------------------------------------------------
log "Pruefe benoetigte Dateien in $SCRIPT_DIR"
for f in server.py static imkerei.service \
         imkerei_wifi_portal.py imkerei-wifi-setup.sh imkerei-wifi-setup.service \
         imkerei-backup.sh imkerei-backup.service imkerei-backup.timer \
         imkerei-update-check.service imkerei-update-check.timer; do
    if [ ! -e "$SCRIPT_DIR/$f" ]; then
        echo "FEHLER: $SCRIPT_DIR/$f fehlt. Wurde der komplette setup-Ordner uebertragen?"
        exit 1
    fi
done

# ---------------------------------------------------------------------------
log "Warte auf Internetverbindung"
tries=0
while ! curl -s --max-time 5 -o /dev/null http://deb.debian.org; do
    tries=$((tries + 1))
    waited=$((tries * 10))
    echo "Kein Internet verfuegbar (Versuch $tries, seit ${waited}s wartend) - erneuter Versuch in 10 Sekunden..."
    sleep 10
done
echo "Internetverbindung erkannt. Warte kurz, bis DNS/Routing sich stabilisiert hat..."
sleep 5

# ---------------------------------------------------------------------------
log "Systemupdate (kann einige Minuten dauern)"
export DEBIAN_FRONTEND=noninteractive

apt_tries=0
until apt-get update; do
    apt_tries=$((apt_tries + 1))
    if [ "$apt_tries" -ge 5 ]; then
        echo "FEHLER: 'apt-get update' ist auch nach $apt_tries Versuchen fehlgeschlagen."
        exit 1
    fi
    echo "'apt-get update' fehlgeschlagen (Versuch $apt_tries) - erneuter Versuch in 10 Sekunden..."
    sleep 10
done

apt-get -y upgrade

# ---------------------------------------------------------------------------
log "SSH aktivieren"
systemctl enable --now ssh

# ---------------------------------------------------------------------------
log "Zeitzone auf Europe/Berlin setzen und Zeit-Synchronisation aktivieren"
# Frisch installierte Raspberry Pi OS Lite/Core-Systeme starten oft mit
# Zeitzone UTC statt Europe/Berlin (dadurch wirkt die Uhrzeit 1-2h "falsch",
# obwohl die Zeit selbst per NTP korrekt synchronisiert ist). Fest setzen,
# damit das nicht bei jeder Neuinstallation erneut manuell korrigiert werden
# muss.
timedatectl set-timezone Europe/Berlin
timedatectl set-ntp true
sleep 2
timedatectl status | grep -E "Zeitzone|Time zone|synchronized|NTP" || true

# ---------------------------------------------------------------------------
log "WLAN-Modul vorbereiten (rfkill / NetworkManager)"
if command -v rfkill >/dev/null; then
    rfkill unblock wifi || true
fi
if command -v nmcli >/dev/null; then
    nmcli radio wifi on || true
    if systemctl is-active --quiet wpa_supplicant.service; then
        echo "Deaktiviere konkurrierenden wpa_supplicant.service (NetworkManager verwaltet WLAN selbst)."
        systemctl disable --now wpa_supplicant.service || true
        systemctl restart NetworkManager || true
    fi
fi

# ---------------------------------------------------------------------------
log "BeeTown-App-Verzeichnis einrichten (/opt/imkerei)"
id -u imkerei >/dev/null 2>&1 || useradd --system --home /opt/imkerei --shell /usr/sbin/nologin imkerei

mkdir -p /opt/imkerei/data
cp "$SCRIPT_DIR/server.py" /opt/imkerei/server.py
rm -rf /opt/imkerei/static
# -L: falls server.py/static im Projekt als Symlink auf den jeweiligen
# Wurzel-Ordner gepflegt werden, hier immer echte Dateien kopieren statt
# eines (auf dem Pi ungueltigen) Symlinks.
cp -rL "$SCRIPT_DIR/static" /opt/imkerei/static
cp "$SCRIPT_DIR/imkerei.service" /opt/imkerei/imkerei.service

# Standard-Logo nur beim allerersten Einrichten setzen, damit ein später über
# die App-Einstellungen hochgeladenes Logo bei einem erneuten Lauf (Update)
# nicht überschrieben wird.
if [ -f "$SCRIPT_DIR/data/logo.jpg" ] && [ ! -f /opt/imkerei/data/logo.jpg ]; then
    cp "$SCRIPT_DIR/data/logo.jpg" /opt/imkerei/data/logo.jpg
fi

chown -R imkerei:imkerei /opt/imkerei
chmod -R u+rwX /opt/imkerei/data
if [ -n "$OWNER" ]; then
    # Code/Static-Dateien dem aufrufenden Benutzer zuordnen, damit kuenftige
    # Updates per FTP/SFTP ohne Berechtigungs-Umwege moeglich sind. data/
    # bleibt beim Dienst-Benutzer imkerei, weil dort zur Laufzeit
    # geschrieben wird (Datenbank, Fotos).
    chown -R "$OWNER:$OWNER" /opt/imkerei
    chown -R imkerei:imkerei /opt/imkerei/data
fi

cp "$SCRIPT_DIR/imkerei.service" /etc/systemd/system/imkerei.service

# ---------------------------------------------------------------------------
log "WLAN-Einstellungen-Portal einrichten (/opt/imkerei-wifi-setup)"
mkdir -p /opt/imkerei-wifi-setup
cp "$SCRIPT_DIR/imkerei_wifi_portal.py" /opt/imkerei-wifi-setup/
cp "$SCRIPT_DIR/imkerei-wifi-setup.sh" /opt/imkerei-wifi-setup/
chmod +x /opt/imkerei-wifi-setup/imkerei-wifi-setup.sh
[ -n "$OWNER" ] && chown -R "$OWNER:$OWNER" /opt/imkerei-wifi-setup

cp "$SCRIPT_DIR/imkerei-wifi-setup.service" /etc/systemd/system/imkerei-wifi-setup.service

# ---------------------------------------------------------------------------
log "Backup-Skript einrichten (/opt/backup-scripts)"
mkdir -p /opt/backup-scripts
cp "$SCRIPT_DIR/imkerei-backup.sh" /opt/backup-scripts/
chmod +x /opt/backup-scripts/imkerei-backup.sh
[ -n "$OWNER" ] && chown -R "$OWNER:$OWNER" /opt/backup-scripts

cp "$SCRIPT_DIR/imkerei-backup.service" /etc/systemd/system/imkerei-backup.service
cp "$SCRIPT_DIR/imkerei-backup.timer" /etc/systemd/system/imkerei-backup.timer

# ---------------------------------------------------------------------------
log "Update-Check einrichten (/opt/imkerei-wifi-setup, taeglich)"
cp "$SCRIPT_DIR/imkerei-update-check.service" /etc/systemd/system/imkerei-update-check.service
cp "$SCRIPT_DIR/imkerei-update-check.timer" /etc/systemd/system/imkerei-update-check.timer

# ---------------------------------------------------------------------------
log "systemd-Dienste aktivieren"
systemctl daemon-reload
systemctl enable --now imkerei.service
# Type=simple - startet sofort im Hintergrund, blockiert das Skript nicht.
# Laeuft dauerhaft (nicht nur bis WLAN eingerichtet ist), damit sich WLAN
# jederzeit spaeter noch einrichten oder wechseln laesst.
systemctl enable --now imkerei-wifi-setup.service
systemctl enable --now imkerei-backup.timer
systemctl enable --now imkerei-update-check.timer
# Einmaligen ersten Check gleich jetzt anstossen, damit die Startseite nicht
# bis zum ersten Timer-Lauf ohne Update-Information dasteht.
systemctl start imkerei-update-check.service || true

is_wifi_connected() {
    nmcli -t -f DEVICE,STATE device status 2>/dev/null \
        | awk -F: '$1=="wlan0" && $2=="connected" {found=1} END{exit !found}'
}

# ---------------------------------------------------------------------------
log "Status"
systemctl --no-pager status imkerei.service | head -5
echo
systemctl --no-pager status imkerei-wifi-setup.service | head -5
echo
systemctl list-timers imkerei-backup.timer --no-pager
echo
echo "App-Test:"
curl -s localhost:8080/api/apiaries && echo || echo "(App antwortet noch nicht - kurz warten und erneut versuchen)"

# ---------------------------------------------------------------------------
log "Boot-Bildschirm einrichten (/etc/issue)"
# agetty wertet \4{iface} bei jeder Anzeige live aus - immer aktuelle IP,
# kein zusaetzlicher Dienst noetig. Sichtbar, sobald ein Monitor am Pi haengt.
cat > /etc/issue << 'EOF'

 🐝 BeeTown-Pi (beetown)
 ======================================================
   Setup / Übersicht:    http://beetown.local
   BeeTown:              http://beetown.local:8080
   WLAN-Einstellungen:    http://beetown.local:8081

   IP-Adressen:  Kabel \4{eth0}   WLAN \4{wlan0}
 ======================================================

EOF

# ---------------------------------------------------------------------------
log "Hostname aendern zu '$NEW_HOSTNAME'"
raspi-config nonint do_hostname "$NEW_HOSTNAME"
echo
echo "======================================================================"
echo " Setup / Übersicht:   http://$NEW_HOSTNAME.local"
echo " BeeTown:            http://$NEW_HOSTNAME.local:8080"
echo " WLAN-Einstellungen:  http://$NEW_HOSTNAME.local:8081 (immer erreichbar)"
echo "======================================================================"
if ! is_wifi_connected; then
    echo
    echo " Noch kein WLAN eingerichtet:"
    echo " 1. Pi per Netzwerkkabel am Router/Switch angeschlossen lassen"
    echo " 2. Nach dem gleich folgenden Neustart im Browser aufrufen:"
    echo "        http://$NEW_HOSTNAME.local  (oder Port 8081)"
    echo " 3. WLAN auswaehlen bzw. SSID eingeben, Passwort eintragen,"
    echo "    auf 'Verbinden' tippen"
    echo " 4. Sobald die Verbindung steht: Netzwerkkabel entfernen"
fi
echo
echo " Diese Seiten bleiben dauerhaft erreichbar - WLAN laesst sich darüber"
echo " jederzeit spaeter wechseln (z. B. nach einem Umzug). Klappt ein"
echo " Wechsel nicht, faellt der Pi automatisch auf die vorher aktive"
echo " Verbindung zurueck, damit er erreichbar bleibt."
echo "======================================================================"
echo
echo "Neustart in 5 Sekunden, um den neuen Hostnamen zu uebernehmen..."
echo "Danach per SSH neu verbinden: ssh <benutzer>@${NEW_HOSTNAME}.local"
sleep 5
reboot
