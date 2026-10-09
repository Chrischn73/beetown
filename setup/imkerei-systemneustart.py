#!/usr/bin/env python3
"""
BeeTown - naechtlicher Systemcheck nach Sicherheitsupdates (nur Raspberry Pi,
laeuft als root ueber imkerei-systemneustart.timer, taeglich 04:00 und 10 Min.
nach dem Boot). Sicherheitsupdates selbst macht unattended-upgrades (install.sh).

- Ist HonigBox auf derselben Box installiert, besitzt DEREN systemneustart.py den
  Neustart (Fotos/Archiv-Schutz) - dieses Skript schreibt dann nur den Status.
- Sonst: Auto-Neustart an UND Laufzeit >= Intervall (4/8/12 Wochen) UND Neustart
  noetig (neuerer Kernel in /lib/modules oder /run/reboot-required) -> Neustart.
- Kein Kernel-Bedarf, aber Pakete seit dem Dienststart aktualisiert -> nur
  imkerei.service neu starten.
Einstellungen stehen in der App-Datenbank (Tabelle settings: sysAutoNeustart,
sysIntervallWochen), Status geht nach data/.systemupdate-status.json.
"""
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
APT_STAMP = "/var/lib/apt/periodic/unattended-upgrades-stamp"
DPKG_LOG = "/var/log/dpkg.log"
GUELTIGE_INTERVALLE = (4, 8, 12)


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
        with open(tmp, "w") as f:
            json.dump(daten, f)
        os.chmod(tmp, 0o644)
        os.replace(tmp, STATUS_PATH)
    except OSError as e:
        print(f"Konnte {STATUS_PATH} nicht schreiben: {e}")


def beschaeftigt():
    if subprocess.run(["systemctl", "is-active", "--quiet", "imkerei-backup.service"]).returncode == 0:
        return "Backup läuft gerade"
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
        subprocess.run(["systemctl", "reboot"], check=False)
        return 0
    if dienst_neu_starten_noetig() and not grund_beschaeftigt:
        schreibe_status(einstellungen, grund, "Dienst wurde nach Paket-Updates neu gestartet.")
        subprocess.run(["systemctl", "restart", "imkerei.service"], check=False)
        return 0
    schreibe_status(einstellungen, grund)
    return 0


if __name__ == "__main__":
    sys.exit(main())
