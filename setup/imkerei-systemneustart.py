#!/usr/bin/env python3
"""
BeeTown - naechtlicher Systemcheck nach Sicherheitsupdates (nur Raspberry Pi,
laeuft als root ueber imkerei-systemneustart.timer, taeglich 05:00 und 10 Min.
nach dem Boot - bewusst nach den App-Updates um 04:00-04:05, siehe
portal_vorgang_laeuft()). Sicherheitsupdates selbst macht unattended-upgrades
(install.sh).

- Ist HonigBox auf derselben Box installiert, besitzt DEREN systemneustart.py den
  Neustart (Fotos/Archiv-Schutz) - dieses Skript schreibt dann nur den Status.
- Sonst: Auto-Neustart an UND Laufzeit >= Intervall (4/8/12 Wochen) UND Neustart
  noetig (neuerer Kernel in /lib/modules oder /run/reboot-required) -> Neustart.
- Kein Kernel-Bedarf, aber Pakete seit dem Dienststart aktualisiert -> nur
  imkerei.service neu starten.
Einstellungen stehen in der App-Datenbank (Tabelle settings: sysAutoNeustart,
sysIntervallWochen), Status geht nach data/.systemupdate-status.json.
"""
import fcntl
import glob
import json
import os
import re
import sqlite3
import subprocess
import sys
import time

DATA_DIR = os.environ.get("IMKEREI_DATA", "/opt/imkerei/data")
DB_PATH = os.path.join(DATA_DIR, "app.db")
STATUS_PATH = os.path.join(DATA_DIR, ".systemupdate-status.json")
HONIGBOX_SKRIPT = "/opt/honigbox/systemneustart.py"
AUTO_NEUSTART_DIR = os.environ.get("AUTO_NEUSTART_DIR", "/var/lib/beetown-auto-neustart")
APT_STAMP = "/var/lib/apt/periodic/unattended-upgrades-stamp"
DPKG_LOG = "/var/log/dpkg.log"
GUELTIGE_INTERVALLE = (4, 8, 12)
# Gemeinsame Update-Sperre des Setup-Portals (flock, siehe setup_portal.py
# try_acquire_update_lock()).
PORTAL_SPERRE = "/run/setup-portal/update.lock"
# Units, die waehrenddessen App-Dateien umbauen oder das Portal neu starten.
UPDATE_UNITS = ("*-update-check.service", "setup-portal-install-*")


def lade_einstellungen():
    werte = {"auto_neustart": True, "intervall_wochen": 4}
    try:
        con = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, timeout=5)
        try:
            roh = dict(con.execute(
                "SELECT key,value FROM settings WHERE key IN ('sysAutoNeustart','sysIntervallWochen')").fetchall())
        finally:
            con.close()
        werte["auto_neustart"] = roh.get("sysAutoNeustart", "true") != "false"
        wochen = int(roh.get("sysIntervallWochen", 4))
        werte["intervall_wochen"] = wochen if wochen in GUELTIGE_INTERVALLE else 4
    except (sqlite3.Error, ValueError):
        pass
    return werte


def laufzeit_sek():
    with open("/proc/uptime") as f:
        return float(f.read().split()[0])


def _versionsschluessel(version):
    return [int(t) for t in re.findall(r"\d+", version)]


def kernel_veraltet():
    """True, wenn fuer die laufende Kernel-Variante (z. B. +rpt-rpi-v8) ein
    neuerer Kernel in /lib/modules installiert ist."""
    laufend = os.uname().release
    treffer = re.match(r"^(\d+(?:\.\d+)*)(.*)$", laufend)
    if not treffer:
        return False
    for pfad in glob.glob("/lib/modules/*"):
        t = re.match(r"^(\d+(?:\.\d+)*)(.*)$", os.path.basename(pfad))
        if t and t.group(2) == treffer.group(2) and \
                _versionsschluessel(t.group(1)) > _versionsschluessel(treffer.group(1)):
            return True
    return False


def neustart_grund():
    if kernel_veraltet():
        return "Kernel-Update"
    if os.path.exists("/run/reboot-required") or os.path.exists("/var/run/reboot-required"):
        return "Systemupdate (Neustart erforderlich)"
    return None


def schreibe_status(einstellungen, grund, notiz=None, honigbox=False):
    stamp = None
    try:
        stamp = os.path.getmtime(APT_STAMP)
    except OSError:
        pass
    daten = {
        "geprueft": time.time(), "letztes_update": stamp, "neustart_noetig": bool(grund),
        "grund": grund, "auto_neustart": einstellungen["auto_neustart"],
        "intervall_wochen": einstellungen["intervall_wochen"],
        "laufzeit_tage": round(laufzeit_sek() / 86400, 1),
        "honigbox": honigbox, "notiz": notiz,
    }
    try:
        tmp = STATUS_PATH + ".tmp"
        # Laeuft als root in data/, das dem Dienstbenutzer gehoert: keinem dort
        # abgelegten Symlink folgen (O_NOFOLLOW + O_EXCL nach dem Entfernen).
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
        with os.fdopen(fd, "w") as f:
            json.dump(daten, f)
            os.fchmod(f.fileno(), 0o644)
        os.replace(tmp, STATUS_PATH)
    except OSError as e:
        print(f"Konnte {STATUS_PATH} nicht schreiben: {e}")


def portal_vorgang_laeuft():
    """True, solange das Setup-Portal eine App aktualisiert/installiert oder
    sich selbst aktualisiert - ein Neustart wuerde das mittendrin abbrechen.
    Fragt die Portal-Sperre und die zugehoerigen systemd-Units ab."""
    try:
        with open(PORTAL_SPERRE) as f:
            try:
                fcntl.flock(f, fcntl.LOCK_SH | fcntl.LOCK_NB)
            except OSError:
                return True
    except OSError:
        pass
    erg = subprocess.run(["systemctl", "list-units", "--no-legend", "--plain",
                          "--state=activating,active,deactivating", *UPDATE_UNITS],
                         capture_output=True, text=True)
    return bool(erg.stdout.strip())


def beschaeftigt():
    if subprocess.run(["systemctl", "is-active", "--quiet", "imkerei-backup.service"]).returncode == 0:
        return "Backup läuft gerade"
    if portal_vorgang_laeuft():
        return "App-Update im Setup-Portal läuft gerade"
    return None


def dienst_neu_starten_noetig():
    """True, wenn dpkg seit dem letzten Start von imkerei.service Pakete geaendert hat."""
    try:
        erg = subprocess.run(["systemctl", "show", "-p", "ActiveEnterTimestampMonotonic", "--value",
                              "imkerei.service"], capture_output=True, text=True)
        start_mono = int(erg.stdout.strip()) / 1e6
        dpkg_mono = time.monotonic() - (time.time() - os.path.getmtime(DPKG_LOG))
    except (OSError, ValueError):
        return False
    return start_mono > 0 and dpkg_mono > start_mono


def markiere_auto_neustart(name):
    """Zeitpunkt eines automatischen Neustarts hinterlegen - die App oeffnet
    danach kein Passwort-Reset-Fenster (server.py _automatisch_gestartet())."""
    try:
        os.makedirs(AUTO_NEUSTART_DIR, mode=0o755, exist_ok=True)
        with open(os.path.join(AUTO_NEUSTART_DIR, name), "w") as f:
            f.write(f"{int(time.time())}\n")
    except OSError:
        pass


def main():
    einstellungen = lade_einstellungen()
    grund = neustart_grund()

    if os.path.exists(HONIGBOX_SKRIPT):
        schreibe_status(einstellungen, grund, honigbox=True)
        return 0
    if laufzeit_sek() < 30 * 60:
        schreibe_status(einstellungen, grund)
        return 0
    if not einstellungen["auto_neustart"]:
        schreibe_status(einstellungen, grund, "Automatischer Neustart ist ausgeschaltet.")
        return 0
    if laufzeit_sek() < einstellungen["intervall_wochen"] * 7 * 86400:
        schreibe_status(einstellungen, grund)
        return 0

    grund_beschaeftigt = beschaeftigt()
    if grund:
        if grund_beschaeftigt:
            schreibe_status(einstellungen, grund, f"Neustart zurückgestellt: {grund_beschaeftigt}.")
            return 0
        schreibe_status(einstellungen, grund, "Neustart wird ausgeführt.")
        markiere_auto_neustart("reboot")
        subprocess.run(["systemctl", "reboot"], check=False)
        return 0
    if dienst_neu_starten_noetig() and not grund_beschaeftigt:
        schreibe_status(einstellungen, grund, "Dienst wurde nach Paket-Updates neu gestartet.")
        markiere_auto_neustart("imkerei.service")
        subprocess.run(["systemctl", "restart", "imkerei.service"], check=False)
        return 0
    schreibe_status(einstellungen, grund)
    return 0


if __name__ == "__main__":
    sys.exit(main())
