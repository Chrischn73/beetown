#!/bin/bash
# Komplette Ersteinrichtung der BeeTown-App - funktioniert sowohl auf einem
# frisch installierten Raspberry Pi OS Lite (Core) als auch auf einem
# normalen Debian-/Linux-Server. Erkennt automatisch, was zutrifft:
#
# - Raspberry Pi: zusaetzlich WLAN-Modul vorbereiten, Boot-Bildschirm
#   (/etc/issue), Hostname auf "beetown" setzen (nur falls noch der
#   Pi-Standard "raspberrypi" gilt) und am Ende neu starten.
# - Normaler Linux-Server: WLAN/Hostname/Boot-Bildschirm/Neustart werden
#   uebersprungen - Hostname und WLAN-Konfiguration eines bestehenden
#   Servers bleiben unangetastet.
#
# In beiden Faellen werden eingerichtet: die BeeTown-App selbst
# (/opt/imkerei, Port 8080), das Setup-Portal mit Backup- und
# Update-Funktion (Port 80, faellt auf einen Ausweich-Port aus, falls 80
# schon belegt ist) sowie die taeglichen Backup-/Update-Check-Timer.
#
# Nutzung:
#   1. Diesen kompletten "setup"-Ordner auf die Zielmaschine kopieren
#      (FTP/SFTP oder direkt per Konsole von GitHub laden, siehe README),
#      z. B. nach /opt/setup.
#   2. sudo bash /opt/setup/install.sh
#
# Mehrfach ausfuehrbar (idempotent) - z. B. nach einem Datei-Update einfach
# erneut laufen lassen.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
    echo "Bitte mit sudo ausfuehren: sudo bash $0"
    exit 1
fi

# ---------------------------------------------------------------------------
# Raspberry Pi vs. normaler Linux-Server: steuert WLAN-Vorbereitung,
# Boot-Bildschirm, Hostname-Aenderung und den Neustart am Ende. Backup,
# Update und die App selbst laufen in beiden Faellen identisch.
IS_PI=0
if grep -qi "raspberry pi" /proc/device-tree/model 2>/dev/null; then
    IS_PI=1
fi
if [ "$IS_PI" -eq 1 ]; then
    echo "Erkannt: Raspberry Pi - volle Einrichtung inkl. WLAN, Hostname, Boot-Bildschirm."
else
    echo "Erkannt: kein Raspberry Pi - richte BeeTown als Linux-Server ein (ohne WLAN/Hostname/Neustart)."
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OWNER="${SUDO_USER:-}"
NEW_HOSTNAME="beetown"
DEFAULT_PI_HOSTNAME="raspberrypi"

log() { echo; echo "==> $*"; }

# ---------------------------------------------------------------------------
log "Pruefe benoetigte Dateien in $SCRIPT_DIR"
for f in server.py static imkerei.service \
         imkerei_wifi_portal.py imkerei-wifi-setup.sh imkerei-wifi-setup.service \
         imkerei-backup.sh imkerei-backup-rotate.py imkerei-backup.service imkerei-backup.timer \
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

if [ "$IS_PI" -eq 1 ]; then
    # -----------------------------------------------------------------------
    log "Zeitzone auf Europe/Berlin setzen und Zeit-Synchronisation aktivieren"
    # Frisch installierte Raspberry Pi OS Lite/Core-Systeme starten oft mit
    # Zeitzone UTC statt Europe/Berlin (dadurch wirkt die Uhrzeit 1-2h
    # "falsch", obwohl die Zeit selbst per NTP korrekt synchronisiert ist).
    # Auf einem Linux-Server verwaltet der Betreiber die Zeitzone bereits
    # selbst - dort nicht anfassen.
    timedatectl set-timezone Europe/Berlin
    timedatectl set-ntp true
    sleep 2
    timedatectl status | grep -E "Zeitzone|Time zone|synchronized|NTP" || true

    # -----------------------------------------------------------------------
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
fi

# ---------------------------------------------------------------------------
log "BeeTown-App-Verzeichnis einrichten (/opt/imkerei)"
id -u imkerei >/dev/null 2>&1 || useradd --system --home /opt/imkerei --shell /usr/sbin/nologin imkerei

mkdir -p /opt/imkerei/data
cp "$SCRIPT_DIR/server.py" /opt/imkerei/server.py
rm -rf /opt/imkerei/static
# -L: falls server.py/static im Projekt als Symlink auf den jeweiligen
# Wurzel-Ordner gepflegt werden, hier immer echte Dateien kopieren statt
# eines (auf dem Zielsystem ungueltigen) Symlinks.
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
log "Setup-Portal einrichten (/opt/imkerei-wifi-setup)"
mkdir -p /opt/imkerei-wifi-setup
cp "$SCRIPT_DIR/imkerei_wifi_portal.py" /opt/imkerei-wifi-setup/
cp "$SCRIPT_DIR/imkerei-wifi-setup.sh" /opt/imkerei-wifi-setup/
chmod +x /opt/imkerei-wifi-setup/imkerei-wifi-setup.sh
[ -n "$OWNER" ] && chown -R "$OWNER:$OWNER" /opt/imkerei-wifi-setup

cp "$SCRIPT_DIR/imkerei-wifi-setup.service" /etc/systemd/system/imkerei-wifi-setup.service

# Auto-Update-Einstellung nur anlegen, falls noch nicht vorhanden - ein
# spaeter am Update-Schalter geaenderter Wert soll bei einem erneuten
# install.sh-Lauf nicht ueberschrieben werden. Standard: AN.
if [ ! -f /opt/imkerei-wifi-setup/update.conf ]; then
    echo "AUTO_UPDATE=1" > /opt/imkerei-wifi-setup/update.conf
fi
[ -n "$OWNER" ] && chown "$OWNER:$OWNER" /opt/imkerei-wifi-setup/update.conf

# ---------------------------------------------------------------------------
log "Backup-Skript einrichten (/opt/backup-scripts)"
mkdir -p /opt/backup-scripts
cp "$SCRIPT_DIR/imkerei-backup.sh" /opt/backup-scripts/
cp "$SCRIPT_DIR/imkerei-backup-rotate.py" /opt/backup-scripts/
chmod +x /opt/backup-scripts/imkerei-backup.sh
[ -n "$OWNER" ] && chown -R "$OWNER:$OWNER" /opt/backup-scripts

cp "$SCRIPT_DIR/imkerei-backup.service" /etc/systemd/system/imkerei-backup.service
cp "$SCRIPT_DIR/imkerei-backup.timer" /etc/systemd/system/imkerei-backup.timer

# ---------------------------------------------------------------------------
log "Update-Check einrichten (/opt/imkerei-wifi-setup, taeglich)"
cp "$SCRIPT_DIR/imkerei-update-check.service" /etc/systemd/system/imkerei-update-check.service
cp "$SCRIPT_DIR/imkerei-update-check.timer" /etc/systemd/system/imkerei-update-check.timer

# ---------------------------------------------------------------------------
log "Pruefe Port 80 fuer das Setup-Portal"
# Auf einem Linux-Server koennte Port 80 bereits von einem vorhandenen
# Webserver belegt sein - dann auf einen Ausweich-Port wechseln, statt den
# Dienststart einfach fehlschlagen zu lassen. Bei jedem Lauf neu anhand der
# tatsaechlich lauschenden PID pruefen (nicht nur einmalig anhand von
# "war der Dienst schon aktiviert"), damit sich ein zwischenzeitlich
# geloester Konflikt auch wieder von selbst korrigiert, statt einen einmal
# gewaehlten Ausweich-Port fuer immer beizubehalten. Ist der aktuelle
# Belegungsinhaber das eigene Setup-Portal selbst, zaehlt das nicht als
# Konflikt.
BEETOWN_PID="$(systemctl show -p MainPID --value imkerei-wifi-setup.service 2>/dev/null || echo 0)"
PORT80_PID="$(ss -H -ltnp "sport = :80" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1)"

if [ -z "$PORT80_PID" ] || { [ "$PORT80_PID" = "$BEETOWN_PID" ] && [ "$BEETOWN_PID" != "0" ]; }; then
    LANDING_PORT=80
    echo "Port 80 ist frei (oder bereits durch das eigene Setup-Portal belegt) - Setup-Portal laeuft dort."
    rm -f /etc/default/imkerei-wifi-setup
else
    LANDING_PORT=8082
    echo "Port 80 ist von einem anderen Prozess belegt (PID $PORT80_PID) - Setup-Portal laeuft stattdessen auf Port $LANDING_PORT."
    echo "IMKEREI_LANDING_PORT=$LANDING_PORT" > /etc/default/imkerei-wifi-setup
fi

# ---------------------------------------------------------------------------
log "systemd-Dienste aktivieren"
systemctl daemon-reload
systemctl enable --now imkerei.service
# Type=simple - startet sofort im Hintergrund, blockiert das Skript nicht.
# Laeuft dauerhaft (nicht nur bis WLAN eingerichtet ist), damit sich WLAN
# jederzeit spaeter noch einrichten oder wechseln laesst.
systemctl enable --now imkerei-wifi-setup.service
# Explizit neu starten, damit ein aktualisiertes Skript und/oder ein neu
# ermittelter Port (siehe oben) bei einem erneuten install.sh-Lauf auch
# tatsaechlich uebernommen werden - "enable --now" allein wuerde einen
# bereits laufenden Dienst unveraendert weiterlaufen lassen.
systemctl restart imkerei-wifi-setup.service
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

SETUP_URL="http://$(hostname).local"
[ "$LANDING_PORT" -ne 80 ] && SETUP_URL="$SETUP_URL:$LANDING_PORT"

if [ "$IS_PI" -eq 1 ]; then
    # -----------------------------------------------------------------------
    log "Boot-Bildschirm einrichten (/etc/issue)"
    # agetty wertet \4{iface} bei jeder Anzeige live aus - immer aktuelle IP,
    # kein zusaetzlicher Dienst noetig. Sichtbar, sobald ein Monitor am Pi haengt.
    cat > /etc/issue << EOF

 🐝 BeeTown-Pi ($NEW_HOSTNAME)
 ======================================================
   Setup / Übersicht:    $SETUP_URL
   BeeTown:              http://$NEW_HOSTNAME.local:8080
   WLAN-Einstellungen:    http://$NEW_HOSTNAME.local:8081

   IP-Adressen:  Kabel \4{eth0}   WLAN \4{wlan0}
 ======================================================

EOF

    # -----------------------------------------------------------------------
    CURRENT_HOSTNAME="$(hostname)"
    EFFECTIVE_HOSTNAME="$CURRENT_HOSTNAME"
    if [ "$CURRENT_HOSTNAME" = "$DEFAULT_PI_HOSTNAME" ]; then
        log "Hostname aendern zu '$NEW_HOSTNAME'"
        raspi-config nonint do_hostname "$NEW_HOSTNAME"
        EFFECTIVE_HOSTNAME="$NEW_HOSTNAME"
        SETUP_URL="http://$NEW_HOSTNAME.local"
        [ "$LANDING_PORT" -ne 80 ] && SETUP_URL="$SETUP_URL:$LANDING_PORT"
    else
        log "Hostname bleibt unveraendert ('$CURRENT_HOSTNAME' ist nicht mehr der Pi-Standard '$DEFAULT_PI_HOSTNAME')"
    fi

    echo
    echo "======================================================================"
    echo " Setup / Übersicht:   $SETUP_URL"
    echo " BeeTown:            http://$EFFECTIVE_HOSTNAME.local:8080"
    echo " WLAN-Einstellungen:  http://$EFFECTIVE_HOSTNAME.local:8081 (immer erreichbar)"
    echo "======================================================================"
    if ! is_wifi_connected; then
        echo
        echo " Noch kein WLAN eingerichtet:"
        echo " 1. Pi per Netzwerkkabel am Router/Switch angeschlossen lassen"
        echo " 2. Nach dem gleich folgenden Neustart im Browser aufrufen:"
        echo "        $SETUP_URL  (oder Port 8081)"
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
    echo "Neustart in 5 Sekunden, um alle Aenderungen sauber zu uebernehmen..."
    echo "Danach per SSH neu verbinden: ssh <benutzer>@$EFFECTIVE_HOSTNAME.local"
    sleep 5
    reboot
else
    echo
    echo "======================================================================"
    echo " Setup / Übersicht:   $SETUP_URL"
    echo " BeeTown:            http://$(hostname):8080"
    echo "======================================================================"
    echo " Hostname und WLAN dieses Servers wurden nicht veraendert."
    echo " Fertig - kein Neustart erforderlich."
fi
