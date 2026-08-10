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
# (/opt/imkerei, Port 8080, faellt auf einen Ausweich-Port aus, falls 8080
# schon belegt ist), das Setup-Portal mit Backup- und Update-Funktion
# (Port 80, faellt auf einen Ausweich-Port aus, falls 80 schon belegt ist)
# sowie die taeglichen Backup-/Update-Check-Timer.
#
# Nutzung:
#   1. Diesen kompletten "setup"-Ordner auf die Zielmaschine kopieren
#      (FTP/SFTP oder direkt per Konsole von GitHub laden, siehe README),
#      z. B. nach /opt/setup.
#   2. sudo bash /opt/setup/install.sh
#
# Mehrfach ausfuehrbar (idempotent) - z. B. nach einem Datei-Update einfach
# erneut laufen lassen.
#
# WICHTIG (an KI-Assistenten wie Claude UND Menschen): pi_setup_portal.py
# in diesem Ordner ist nur eine Deployment-KOPIE, NICHT App-eigener Code -
# NICHT direkt bearbeiten. Kanonische Quelle (dort bearbeiten, dann
# ./sync.sh dort ausfuehren):
#   /media/SSD/Sichern/claude/pi-setup-portal/pi_setup_portal.py
# Siehe den ausfuehrlichen Warnhinweis am Anfang von pi_setup_portal.py.
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
# server.py/static gibt es in zwei gueltigen Layouts, je nach Kopiermethode:
#   1. Kompletter Projekt-Ordner uebertragen (z. B. Option A per Git-Tarball)
#      -> server.py/static liegen eine Ebene ueber setup/ (PROJECT_DIR).
#   2. Nur der setup/-Ordner alleine uebertragen, mit aufgeloesten Symlinks
#      (z. B. per "cp -rL setup/ /opt/setup", siehe docs/raspberry-pi.md)
#      -> server.py/static liegen direkt IN setup/ (SCRIPT_DIR).
# Im Repo selbst sind setup/server.py und setup/static nur bequeme relative
# Symlinks auf PROJECT_DIR fuer die lokale Entwicklung - beim Uebertragen
# auf einen Pi wird bevorzugt PROJECT_DIR verwendet (Layout 1), aber auf
# SCRIPT_DIR zurueckgefallen (Layout 2), falls PROJECT_DIR nichts hat.
# Bewusst NICHT blind ueber die Symlinks in setup/ gehen: manche
# Kopiermethoden (SFTP-GUI-Tools, ZIP-Download, Windows ohne Symlink-
# Unterstuetzung in Git) uebertragen Symlinks nicht zuverlaessig, was den
# kompletten Ordner sonst als "server.py fehlt" abbrechen liesse, obwohl
# die eigentliche Datei (in einem der beiden Layouts) tatsaechlich da ist.
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
if [ -e "$PROJECT_DIR/server.py" ] && [ -e "$PROJECT_DIR/static" ]; then
    APP_SRC_DIR="$PROJECT_DIR"
elif [ -e "$SCRIPT_DIR/server.py" ] && [ -e "$SCRIPT_DIR/static" ]; then
    APP_SRC_DIR="$SCRIPT_DIR"
else
    echo "FEHLER: server.py/static weder in $PROJECT_DIR noch in $SCRIPT_DIR gefunden."
    echo "Wurde entweder der komplette Projekt-Ordner ODER der setup/-Ordner mit"
    echo "aufgeloesten Symlinks (cp -rL) uebertragen?"
    exit 1
fi
OWNER="${SUDO_USER:-}"
NEW_HOSTNAME="beetown"
DEFAULT_PI_HOSTNAME="raspberrypi"

log() { echo; echo "==> $*"; }

# ---------------------------------------------------------------------------
log "Pruefe benoetigte Dateien in $APP_SRC_DIR bzw. $SCRIPT_DIR"
for f in imkerei.service \
         pi_setup_portal.py pi-setup-portal.sh pi-setup-portal.service regen-issue.sh \
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

if [ "$IS_PI" -eq 0 ]; then
    # -----------------------------------------------------------------------
    log "Avahi (mDNS) installieren, damit .local-Adressen funktionieren"
    # Raspberry Pi OS bringt avahi-daemon von Haus aus mit - ein normaler
    # Linux-Server (insbesondere ein minimaler LXC-Container) in der Regel
    # nicht. Ohne mDNS-Ankuendigung ist der Server trotz ueberall angezeigter
    # ".local"-URLs nur per IP erreichbar.
    apt-get install -y avahi-daemon avahi-utils
    systemctl enable --now avahi-daemon
fi

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
cp "$APP_SRC_DIR/server.py" /opt/imkerei/server.py
rm -rf /opt/imkerei/static
# -L: falls static im Projekt selbst noch als Symlink gepflegt wird, hier
# immer echte Dateien kopieren statt eines (auf dem Zielsystem ungueltigen)
# Symlinks.
cp -rL "$APP_SRC_DIR/static" /opt/imkerei/static
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
log "Gemeinsames Pi-Setup-Portal einrichten (/opt/pi-setup-portal)"
# Seit Kurzem bringt die Imker-App (BeeTown) keine eigenstaendige Setup-Seite
# mehr mit, sondern registriert sich nur noch bei einem gemeinsamen Portal,
# das auch HonigBox mitnutzen kann, falls sie auf demselben Pi installiert
# ist bzw. wird - siehe apps.d/imkerei.json weiter unten.
mkdir -p /opt/pi-setup-portal/apps.d /opt/pi-setup-portal/issue.d \
         /opt/pi-setup-portal/state/imkerei /opt/pi-setup-portal/hilfe-bilder/_shared

# Portal-Code nur aktualisieren, wenn die mitgelieferte Version neuer (oder
# noch gar nicht installiert) ist - andernfalls koennte ein aelterer
# Imker-App-Stand eine von HonigBox bereits aktualisierte, neuere
# Portal-Version wieder zurueckstufen (und umgekehrt).
BUNDLED_PORTAL_VERSION="$(grep -oP '^PORTAL_VERSION = "\K[^"]+' "$SCRIPT_DIR/pi_setup_portal.py")" || {
    echo "FEHLER: Konnte PORTAL_VERSION nicht aus $SCRIPT_DIR/pi_setup_portal.py auslesen."
    exit 1
}
INSTALLED_PORTAL_VERSION="$(grep -oP '^PORTAL_VERSION = "\K[^"]+' /opt/pi-setup-portal/pi_setup_portal.py 2>/dev/null || echo "0")"
# PORTAL_CODE_UPDATED steuert weiter unten, ob pi-setup-portal.service neu
# gestartet wird. Ein Neustart ist nur bei tatsaechlich neuem Code sinnvoll
# - dieser Dienst wird von HonigBox mitbenutzt, ein unnoetiger Neustart
# wuerde deren gerade laufende WLAN-/Backup-/Update-Vorgaenge mitten drin
# abbrechen. Deshalb bewusst DREI Faelle statt nur zwei: noch nicht
# installiert (deployen), gleiche Version (nichts tun - sonst wuerde jeder
# blosse Re-Lauf, auch ohne jede Codeaenderung, staendig neu starten),
# oder mitgelieferte Version wirklich neuer (deployen) bzw. aeltere
# installierte Version bereits neuer (nichts tun).
PORTAL_CODE_UPDATED=0
if [ ! -e /opt/pi-setup-portal/pi_setup_portal.py ]; then
    NEED_PORTAL_DEPLOY=1
elif [ "$INSTALLED_PORTAL_VERSION" = "$BUNDLED_PORTAL_VERSION" ]; then
    NEED_PORTAL_DEPLOY=0
elif [ "$(printf '%s\n%s\n' "$INSTALLED_PORTAL_VERSION" "$BUNDLED_PORTAL_VERSION" | sort -V | tail -1)" = "$BUNDLED_PORTAL_VERSION" ]; then
    NEED_PORTAL_DEPLOY=1
else
    NEED_PORTAL_DEPLOY=0
fi
if [ "$NEED_PORTAL_DEPLOY" -eq 1 ]; then
    cp "$SCRIPT_DIR/pi_setup_portal.py" /opt/pi-setup-portal/pi_setup_portal.py
    cp "$SCRIPT_DIR/pi-setup-portal.sh" /opt/pi-setup-portal/pi-setup-portal.sh
    chmod +x /opt/pi-setup-portal/pi-setup-portal.sh
    cp "$SCRIPT_DIR/pi-setup-portal.service" /etc/systemd/system/pi-setup-portal.service
    PORTAL_CODE_UPDATED=1
    echo "Portal-Code auf Version $BUNDLED_PORTAL_VERSION aktualisiert (vorher: $INSTALLED_PORTAL_VERSION)."
else
    echo "Portal-Code bereits auf Version $INSTALLED_PORTAL_VERSION (mitgeliefert: $BUNDLED_PORTAL_VERSION) - unveraendert gelassen."
fi
cp "$SCRIPT_DIR/regen-issue.sh" /opt/pi-setup-portal/regen-issue.sh
chmod +x /opt/pi-setup-portal/regen-issue.sh

# Screenshots fuer die VPN-Hilfeseite - legt der Nutzer selbst hier ab (per
# SFTP/FileZilla direkt auf dem Server, oder vorher in setup/hilfe-bilder/
# im Projekt, dann kommen sie mit hierher). Komplett optional. Die
# Fritzbox/WireGuard-Anleitung ist app-unabhaengig, siehe "_shared" im
# gemeinsamen Portal.
cp -rn "$SCRIPT_DIR/hilfe-bilder/." /opt/pi-setup-portal/hilfe-bilder/_shared/ 2>/dev/null || true
[ -n "$OWNER" ] && chown -R "$OWNER:$OWNER" /opt/pi-setup-portal/hilfe-bilder/_shared

# Migration: eine von einer frueheren install.sh-Version installierte
# eigenstaendige BeeTown-Setup-Seite ablösen. Eigene Auto-Update-Einstellung
# des Nutzers wird dabei uebernommen statt verworfen.
if [ -e /etc/systemd/system/imkerei-wifi-setup.service ]; then
    log "Alte eigenstaendige BeeTown-Setup-Seite ablösen (jetzt gemeinsames Pi-Setup-Portal)"
    systemctl disable --now imkerei-wifi-setup.service 2>/dev/null || true
    rm -f /etc/systemd/system/imkerei-wifi-setup.service /etc/default/imkerei-wifi-setup
fi
if [ -f /opt/imkerei-wifi-setup/update.conf ]; then
    cp -n /opt/imkerei-wifi-setup/update.conf /opt/pi-setup-portal/state/imkerei/update.conf
fi
rm -rf /opt/imkerei-wifi-setup

# Auto-Update-Einstellung nur anlegen, falls noch nicht vorhanden - ein
# spaeter am Update-Schalter geaenderter Wert soll bei einem erneuten
# install.sh-Lauf nicht ueberschrieben werden. Standard: AN.
if [ ! -f /opt/pi-setup-portal/state/imkerei/update.conf ]; then
    echo "AUTO_UPDATE=1" > /opt/pi-setup-portal/state/imkerei/update.conf
fi

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
log "Update-Check einrichten (taeglich)"
cp "$SCRIPT_DIR/imkerei-update-check.service" /etc/systemd/system/imkerei-update-check.service
cp "$SCRIPT_DIR/imkerei-update-check.timer" /etc/systemd/system/imkerei-update-check.timer

# ---------------------------------------------------------------------------
log "Pruefe Port 80 fuer das gemeinsame Pi-Setup-Portal"
# Auf einem Linux-Server koennte Port 80 bereits von einem vorhandenen
# Webserver belegt sein - dann auf einen Ausweich-Port wechseln, statt den
# Dienststart einfach fehlschlagen zu lassen. Bei jedem Lauf neu anhand der
# tatsaechlich lauschenden PID pruefen (nicht nur einmalig anhand von
# "war der Dienst schon aktiviert"), damit sich ein zwischenzeitlich
# geloester Konflikt auch wieder von selbst korrigiert. Port 80 gehoert
# jetzt dem gemeinsamen pi-setup-portal.service statt einem BeeTown-eigenen
# Dienst - dieselbe Pruefung fuehrt HonigBox in ihrem eigenen install.sh
# aus, falls sie auf demselben Pi installiert ist/wird.
SETUP_PID="$(systemctl show -p MainPID --value pi-setup-portal.service 2>/dev/null || echo 0)"
PORT80_PID="$(ss -H -ltnp "sport = :80" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1 || true)"

if [ -z "$PORT80_PID" ] || { [ "$PORT80_PID" = "$SETUP_PID" ] && [ "$SETUP_PID" != "0" ]; }; then
    LANDING_PORT=80
    echo "Port 80 ist frei (oder bereits durch das Pi-Setup-Portal selbst belegt) - Portal laeuft dort."
    rm -f /etc/default/pi-setup-portal
else
    LANDING_PORT=8082
    echo "Port 80 ist von einem anderen Prozess belegt (PID $PORT80_PID) - Pi-Setup-Portal laeuft stattdessen auf Port $LANDING_PORT."
    echo "PI_SETUP_LANDING_PORT=$LANDING_PORT" > /etc/default/pi-setup-portal
fi

# ---------------------------------------------------------------------------
log "Pruefe Port 8080 fuer BeeTown"
# Gleiche Logik wie bei Port 80 oben: auf einem Linux-Server koennte 8080
# schon von einer anderen Anwendung belegt sein.
APP_PID="$(systemctl show -p MainPID --value imkerei.service 2>/dev/null || echo 0)"
PORT8080_PID="$(ss -H -ltnp "sport = :8080" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1 || true)"

if [ -z "$PORT8080_PID" ] || { [ "$PORT8080_PID" = "$APP_PID" ] && [ "$APP_PID" != "0" ]; }; then
    APP_PORT=8080
    echo "Port 8080 ist frei (oder bereits durch BeeTown selbst belegt) - BeeTown laeuft dort."
    rm -f /etc/default/imkerei
else
    APP_PORT=8083
    echo "Port 8080 ist von einem anderen Prozess belegt (PID $PORT8080_PID) - BeeTown laeuft stattdessen auf Port $APP_PORT."
    echo "IMKEREI_PORT=$APP_PORT" > /etc/default/imkerei
fi

# ---------------------------------------------------------------------------
log "BeeTown im gemeinsamen Pi-Setup-Portal registrieren"
cat > /opt/pi-setup-portal/apps.d/imkerei.json << JSONEOF
{
  "id": "imkerei",
  "label": "BeeTown",
  "emoji": "🐝",
  "beschreibung": "App für die Imkerei-Verwaltung: Bienenstände, Rühr-Vorgänge und Honigverkauf erfassen und dokumentieren.",
  "app_port_default": 8080,
  "app_port_env_file": "/etc/default/imkerei",
  "app_port_env_var": "IMKEREI_PORT",
  "backup": {
    "script": "/opt/backup-scripts/imkerei-backup.sh",
    "prefix": "imkerei-backup",
    "restore_data_prefix": "imkerei/data",
    "restore_target_dir": "/opt/imkerei/data",
    "restore_owner": "imkerei:imkerei",
    "restore_stop_services": ["imkerei.service"],
    "restore_start_services": ["imkerei.service"],
    "restored_label": "Datenbank und Fotos"
  },
  "update": {
    "github_repo": "Chrischn73/beetown",
    "version_file": "/opt/imkerei/static/app.js",
    "version_regex": "APP_VERSION = '([^']+)'",
    "file_map": [
      {"src": "server.py", "dest": "/opt/imkerei/server.py", "mode": "0644", "chown": "imkerei:imkerei"},
      {"src": "static", "dest": "/opt/imkerei/static", "mode": "dir", "chown": "imkerei:imkerei"}
    ],
    "services_to_restart": ["imkerei.service"]
  },
  "donate": {
    "text": "Schön, dass BeeTown dir nützt! Die App bleibt kostenlos und werbefrei – über eine kleine Spende für Kaffee & Weiterentwicklung freue ich mich sehr.",
    "url": "https://www.paypal.com/donate/?hosted_button_id=F7WE7N68TBAKE",
    "button_label": "☕ BeeTown unterstützen"
  },
  "companion": {
    "app_id": "honigbox",
    "label": "BeeTown HonigBox",
    "emoji": "🍯",
    "github_repo": "Chrischn73/honigbox",
    "beschreibung": "Überwacht die Tür einer Honig-Verkaufsbox per Kontaktschalter, macht bei jeder Öffnung automatisch Fotos und schickt eine Push-Benachrichtigung ans Handy. Läuft direkt auf einem Raspberry Pi in der Box."
  }
}
JSONEOF

# ---------------------------------------------------------------------------
log "systemd-Dienste aktivieren"
systemctl daemon-reload
systemctl enable --now imkerei.service
# Explizit neu starten, damit ein aktualisiertes server.py und/oder ein neu
# ermittelter Port (siehe oben) bei einem erneuten install.sh-Lauf auch
# tatsaechlich uebernommen werden - "enable --now" allein wuerde einen
# bereits laufenden Dienst unveraendert weiterlaufen lassen.
systemctl restart imkerei.service
# Type=simple - startet sofort im Hintergrund, blockiert das Skript nicht.
# Laeuft dauerhaft (nicht nur bis WLAN eingerichtet ist), damit sich WLAN
# jederzeit spaeter noch einrichten oder wechseln laesst.
systemctl enable --now pi-setup-portal.service
# Nur neu starten, wenn oben tatsaechlich neuer Portal-Code deployt wurde -
# sonst wuerde jeder blosse Re-Lauf von install.sh die von HonigBox
# mitgenutzte Setup-Seite unnoetig durchstarten (siehe Kommentar beim
# Versionsvergleich weiter oben). "enable --now" allein startet den Dienst
# nur, falls er noch gar nicht laeuft - laesst einen bereits laufenden,
# unveraenderten Dienst in Ruhe.
if [ "$PORTAL_CODE_UPDATED" -eq 1 ]; then
    systemctl restart pi-setup-portal.service
fi
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
# "|| true" ist hier wichtig: "systemctl status" gibt einen Exit-Code != 0
# zurueck, sobald ein Dienst nicht "active (running)" ist (z. B. noch beim
# Start). Ohne "|| true" wuerde "set -e" das Skript hier abbrechen, noch
# VOR dem Boot-Bildschirm und den Abschluss-Hinweisen.
systemctl --no-pager status imkerei.service | head -5 || true
echo
systemctl --no-pager status pi-setup-portal.service | head -5 || true
echo
systemctl list-timers imkerei-backup.timer --no-pager || true
echo
echo "App-Test:"
curl -s "localhost:$APP_PORT/api/apiaries" && echo || echo "(App antwortet noch nicht - kurz warten und erneut versuchen)"

SETUP_URL="http://$(hostname).local"
[ "$LANDING_PORT" -ne 80 ] && SETUP_URL="$SETUP_URL:$LANDING_PORT"

if [ "$IS_PI" -eq 1 ]; then
    # -----------------------------------------------------------------------
    # Hostname-Entscheidung ZUERST, danach erst den Boot-Bildschirm
    # schreiben - sonst landet die alte/neue Hostname-Variante inkonsistent
    # in /etc/issue (z. B. "raspberrypi.local", obwohl der Pi gleich auf
    # "beetown" umbenannt wird und danach neu startet).
    CURRENT_HOSTNAME="$(hostname)"
    EFFECTIVE_HOSTNAME="$CURRENT_HOSTNAME"
    HOSTNAME_CHANGED=0
    if [ "$CURRENT_HOSTNAME" = "$DEFAULT_PI_HOSTNAME" ]; then
        log "Hostname aendern zu '$NEW_HOSTNAME'"
        raspi-config nonint do_hostname "$NEW_HOSTNAME"
        EFFECTIVE_HOSTNAME="$NEW_HOSTNAME"
        HOSTNAME_CHANGED=1
        SETUP_URL="http://$NEW_HOSTNAME.local"
        [ "$LANDING_PORT" -ne 80 ] && SETUP_URL="$SETUP_URL:$LANDING_PORT"
    else
        log "Hostname bleibt unveraendert ('$CURRENT_HOSTNAME' ist nicht mehr der Pi-Standard '$DEFAULT_PI_HOSTNAME')"
    fi

    # -----------------------------------------------------------------------
    log "Boot-Bildschirm einrichten (/etc/issue)"
    # /etc/issue wird aus Fragmenten zusammengesetzt (siehe regen-issue.sh) -
    # "00-" ist die gemeinsame Setup-URL (identischer Inhalt, egal welche
    # App sie zuletzt geschrieben hat), "20-" ist die BeeTown-eigene Zeile.
    # Beide nutzen jetzt $EFFECTIVE_HOSTNAME/das schon aktualisierte
    # $SETUP_URL statt der Werte von VOR der Hostname-Entscheidung. agetty
    # wertet \4{iface} bei jeder Anzeige live aus (siehe regen-issue.sh) -
    # immer aktuelle IP, kein zusaetzlicher Dienst noetig.
    cat > /opt/pi-setup-portal/issue.d/00-setup-url.txt << EOF
   Setup / Übersicht:   $SETUP_URL
EOF
    cat > /opt/pi-setup-portal/issue.d/20-imkerei.txt << EOF
   BeeTown:             http://$EFFECTIVE_HOSTNAME.local:$APP_PORT
EOF
    /opt/pi-setup-portal/regen-issue.sh

    echo
    echo "======================================================================"
    echo " Setup / Übersicht:   $SETUP_URL"
    echo " BeeTown:            http://$EFFECTIVE_HOSTNAME.local:$APP_PORT"
    echo " WLAN-Einstellungen:  $SETUP_URL/wifi (immer erreichbar)"
    echo "======================================================================"
    if ! is_wifi_connected; then
        echo
        echo " Noch kein WLAN eingerichtet:"
        echo " 1. Pi per Netzwerkkabel am Router/Switch angeschlossen lassen"
        if [ "$HOSTNAME_CHANGED" -eq 1 ]; then
            echo " 2. Nach dem gleich folgenden Neustart im Browser aufrufen:"
        else
            echo " 2. Im Browser aufrufen:"
        fi
        echo "        $SETUP_URL  (dort auf 'WLAN-Einstellungen' tippen)"
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
    if [ "$HOSTNAME_CHANGED" -eq 1 ]; then
        echo
        echo "Neustart in 5 Sekunden, um den neuen Hostnamen zu uebernehmen..."
        echo "Danach per SSH neu verbinden: ssh <benutzer>@$EFFECTIVE_HOSTNAME.local"
        sleep 5
        reboot
    else
        echo
        echo "Hostname war bereits angepasst - kein Neustart erforderlich. Fertig."
    fi
else
    echo
    echo "======================================================================"
    echo " Setup / Übersicht:   $SETUP_URL"
    echo " BeeTown:            http://$(hostname).local:$APP_PORT"
    echo "======================================================================"
    echo " Hostname und WLAN dieses Servers wurden nicht veraendert."
    echo " Fertig - kein Neustart erforderlich."
fi
