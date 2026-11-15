#!/usr/bin/env python3
"""
BeeTown – kleiner Server (nur Python-Standardbibliothek).
"""

import os, re, json, sqlite3, secrets, mimetypes, hashlib, hmac, html, time, http.cookies
import shutil, sys, tempfile, traceback, zipfile
from datetime import datetime, timezone, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE       = os.path.dirname(os.path.abspath(__file__))
HOST       = os.environ.get("IMKEREI_HOST", "0.0.0.0")
PORT       = int(os.environ.get("IMKEREI_PORT", "8080"))
DATA_DIR   = os.environ.get("IMKEREI_DATA",   os.path.join(BASE, "data"))
STATIC_DIR = os.environ.get("IMKEREI_STATIC", os.path.join(BASE, "static"))
PHOTO_DIR  = os.path.join(DATA_DIR, "photos")
LOGO_PATH  = os.path.join(DATA_DIR, "logo.jpg")
DB_PATH    = os.path.join(DATA_DIR, "app.db")

# Einfacher "FritzBox-Stil"-Zugangsschutz fuer die Web-Oberflaeche - EIN
# gemeinsames Passwort fuer alle, kein Benutzerkonto. Portiert aus der
# HonigBox-Galerie (siehe galerie_server.py dort) - dort zusaetzlich mit
# einer Foto-Archiv-Verschluesselung verknuepft, hier bewusst NUR das
# Browser-Passwort ohne Datenverlust-Konsequenz beim Zuruecksetzen (waere bei
# jahrelangen Stockkarten-Daten unangemessen, ergab bei der Fotobox aber
# Sinn als Schutz gegen einen missbrauchten Reset).
ZUGANG_PATH = os.path.join(DATA_DIR, ".zugang.json")
ZUGANG_COOKIE_NAME = "beetown_zugang"
ZUGANG_COOKIE_MAX_AGE = 10 * 365 * 86400  # ~10 Jahre - "nie wieder fragen"
ZUGANG_PBKDF2_ITERATIONEN = 200_000
ZUGANG_MINDESTLAENGE = 4
ZUGANG_DEAKTIVIERT = os.environ.get("IMKEREI_ZUGANG_AUS", "") == "1"
# Passwort vergessen? Ein Reset ist bewusst nur kurz nach einem Dienst-Neustart
# moeglich - die einzige Huerde gegen jemanden mit einem gestohlenen
# Session-Cookie, der sonst jederzeit per /zuruecksetzen ein neues Passwort
# setzen koennte. _ZUGANG_PROZESS_START wird beim Modul-Import gesetzt, also
# bei jedem Dienststart neu.
ZUGANG_RESET_FENSTER_SEKUNDEN = 10 * 60
_ZUGANG_PROZESS_START = time.time()


def zugang_eingerichtet():
    return os.path.isfile(ZUGANG_PATH)


def _lade_zugang():
    try:
        with open(ZUGANG_PATH) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def setze_zugang_passwort(passwort):
    """Setzt ein (neues) Passwort - fuer die Ersteinrichtung genauso wie fuer
    einen spaeteren Reset. Erzeugt dabei immer ein neues server_secret,
    wodurch alle bisher ausgestellten Anmelde-Cookies (auch in ANDEREN
    Browsern) automatisch ungueltig werden - ein Reset meldet also ueberall
    ab, nicht nur im aktuellen Browser."""
    passwort = str(passwort or "")
    if len(passwort) < ZUGANG_MINDESTLAENGE:
        raise ValueError(f"Passwort muss mindestens {ZUGANG_MINDESTLAENGE} Zeichen haben")
    salt = secrets.token_bytes(16)
    hash_ = hashlib.pbkdf2_hmac("sha256", passwort.encode(), salt, ZUGANG_PBKDF2_ITERATIONEN)
    daten = {"hash": hash_.hex(), "salt": salt.hex(), "server_secret": secrets.token_hex(32)}
    with open(ZUGANG_PATH, "w") as f:
        json.dump(daten, f)
    try:
        os.chmod(ZUGANG_PATH, 0o600)
    except OSError:
        pass
    return daten


def pruefe_zugang_passwort(passwort):
    """hmac.compare_digest statt == , damit die Vergleichsdauer selbst kein
    Seitenkanal ist, der Rueckschluesse auf einzelne richtige Zeichen erlaubt."""
    daten = _lade_zugang()
    if not daten:
        return False
    try:
        salt = bytes.fromhex(daten["salt"])
        erwartet = bytes.fromhex(daten["hash"])
    except (KeyError, ValueError, TypeError):
        return False
    hash_ = hashlib.pbkdf2_hmac("sha256", str(passwort or "").encode(), salt, ZUGANG_PBKDF2_ITERATIONEN)
    return hmac.compare_digest(hash_, erwartet)


def _zugang_cookie_sollwert():
    daten = _lade_zugang()
    if not daten:
        return None
    try:
        secret = bytes.fromhex(daten["server_secret"])
    except (KeyError, ValueError, TypeError):
        return None
    return hmac.new(secret, b"beetown-zugang-v1", hashlib.sha256).hexdigest()


def zugang_cookie_gueltig(cookie_header):
    sollwert = _zugang_cookie_sollwert()
    if not sollwert:
        return False
    try:
        cookies = http.cookies.SimpleCookie(cookie_header or "")
    except http.cookies.CookieError:
        return False
    morsel = cookies.get(ZUGANG_COOKIE_NAME)
    if not morsel:
        return False
    return hmac.compare_digest(morsel.value, sollwert)


# Automatische bzw. ohne Login ausloesbare Neustarts (Update ueber das
# Setup-Portal, naechtlicher Systemcheck, "Neu starten" im Portal)
# hinterlegen hier vorher eine Markierung ("imkerei.service", "alle" fuer
# install.sh-Laeufe oder "reboot"). Ein so ausgeloester Dienststart oeffnet
# das Reset-Fenster NICHT - sonst koennte jeder, der Port 8080 erreicht, das
# Auto-Update um 04:00 abpassen und ein neues Passwort setzen. Ein Neustart
# von Hand (systemctl restart, Strom) oeffnet es weiterhin.
AUTO_NEUSTART_DIR = os.environ.get("AUTO_NEUSTART_DIR", "/var/lib/beetown-auto-neustart")


def _automatisch_gestartet():
    def markiert(name):
        try: return os.path.getmtime(os.path.join(AUTO_NEUSTART_DIR, name))
        except OSError: return None
    for name in ("imkerei.service", "alle"):
        m = markiert(name)
        # 40 Min. Spielraum: ein install.sh-Lauf markiert am Anfang und
        # startet den Dienst erst spaeter neu.
        if m is not None and m >= _ZUGANG_PROZESS_START - 40 * 60:
            return True
    m = markiert("reboot")
    if m is not None:
        try:
            with open("/proc/uptime") as f:
                boot = time.time() - float(f.read().split()[0])
        except (OSError, ValueError, IndexError):
            return False
        if _ZUGANG_PROZESS_START - boot < ZUGANG_RESET_FENSTER_SEKUNDEN and m >= boot - 3600:
            return True
    return False


def zugang_reset_moeglich():
    return (zugang_eingerichtet() and (time.time() - _ZUGANG_PROZESS_START) < ZUGANG_RESET_FENSTER_SEKUNDEN
            and not _automatisch_gestartet())


def zugang_per_einstellung_deaktiviert():
    """Zusaetzlich zum env-Schalter IMKEREI_ZUGANG_AUS (fuer Tests/Dev) auch aus
    den App-Einstellungen abschaltbar (Einstellungen -> System) - wirkt sofort
    bei der naechsten Anfrage, kein Dienst-Neustart noetig."""
    try:
        con = db()
        row = con.execute("SELECT value FROM settings WHERE key='zugangDeaktiviert'").fetchone()
        con.close()
        return bool(row) and row["value"] == "true"
    except sqlite3.Error:
        return False


_ZUGANG_SEITE_TEMPLATE = """<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#1e1a14">
<meta name="color-scheme" content="light dark">
<script>try{var t=localStorage.getItem('imkerei-theme');if(t)document.documentElement.setAttribute('data-theme',t);}catch(e){}</script>
<title>BeeTown</title>
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<div class="zugang-wrap">
  <div class="zugang-karte">
    <h1>\U0001F41D BeeTown</h1>
    <p class="muted">__INTRO__</p>
    __FEHLER__
    __FORMULAR__
  </div>
</div>
</body>
</html>
"""


def _zugang_seite(intro, formular_html, fehler=None):
    fehler_html = f'<p class="warnhinweis">{html.escape(fehler)}</p>' if fehler else ""
    return (_ZUGANG_SEITE_TEMPLATE
            .replace("__INTRO__", html.escape(intro))
            .replace("__FEHLER__", fehler_html)
            .replace("__FORMULAR__", formular_html))


def _seite_einrichten(fehler=None):
    formular = """<form method="POST" action="/einrichten" class="zugang-form">
      <input type="password" name="passwort" placeholder="Neues Passwort" minlength="4" required autofocus>
      <input type="password" name="passwort2" placeholder="Passwort wiederholen" minlength="4" required>
      <button type="submit" class="btn btn-primary">Passwort festlegen</button>
    </form>
    <p class="muted zugang-hinweis">Wird nur EINMAL abgefragt - danach merkt sich dieser Browser den
    Zugang dauerhaft. Lässt sich später in den Einstellungen (System) wieder abschalten.</p>"""
    return _zugang_seite(
        "Willkommen! Bitte lege ein Passwort für den Zugriff auf diese Seite fest.", formular, fehler)


def _seite_login(fehler=None):
    formular = """<form method="POST" action="/login" class="zugang-form">
      <input type="password" name="passwort" placeholder="Passwort" required autofocus>
      <button type="submit" class="btn btn-primary">Anmelden</button>
    </form>"""
    if zugang_reset_moeglich():
        formular += ('<p class="muted zugang-hinweis">Passwort vergessen? '
                     '<a href="/zuruecksetzen">Jetzt zurücksetzen</a>.</p>')
    else:
        formular += ('<p class="muted zugang-hinweis">Passwort vergessen? Server bzw. Dienst '
                     'von Hand neu starten - direkt danach erscheint hier für 10 Minuten ein Link zum '
                     'Zurücksetzen. Nach automatischen Updates und Neustarts erscheint er bewusst nicht.</p>')
    return _zugang_seite("Bitte Passwort eingeben.", formular, fehler)


def _seite_zuruecksetzen(fehler=None):
    formular = """<form method="POST" action="/zuruecksetzen" class="zugang-form">
      <input type="password" name="passwort" placeholder="Neues Passwort" minlength="4" required autofocus>
      <input type="password" name="passwort2" placeholder="Passwort wiederholen" minlength="4" required>
      <button type="submit" class="btn btn-primary">Passwort zurücksetzen</button>
    </form>
    <p class="muted zugang-hinweis"><a href="/login">Abbrechen</a></p>"""
    return _zugang_seite(
        "Neues Passwort festlegen - deine gespeicherten Daten (Stockkarten, Verkäufe usw.) bleiben "
        "dabei unangetastet.", formular, fehler)
# Wird von setup/install.sh angelegt - sowohl auf einem Raspberry Pi als
# auch auf einem generischen Linux-Server (beide bekommen das Setup-Portal
# seit der Linux-Server-Unterstuetzung gleichermassen). Dient als
# Erkennungsmerkmal fuer /api/platform, ob es ueberhaupt eine Setup-Seite
# gibt, auf die verwiesen werden kann (Backup/Update) - NICHT ob es
# speziell ein Raspberry Pi ist, dafuer siehe _is_raspberry_pi(). Seit dem
# Umbau auf das App-uebergreifende, gemeinsame Portal (auch fuer HonigBox
# nutzbar) liegt das unter /opt/setup-portal (vorher: /opt/imkerei-wifi-setup).
PI_MARKER_DIR = "/opt/setup-portal"


def _is_raspberry_pi():
    """Echte Hardware-Erkennung (wie in setup_portal.py) - im
    Unterschied zu PI_MARKER_DIR (der nur "Setup-Portal installiert"
    bedeutet, auch auf einem Linux-Server). Fuer Pi-spezifische Dinge wie
    die USB-Backup-Warnung (SD-Karten-Ausfallrisiko betrifft nur den Pi)."""
    try:
        with open("/proc/device-tree/model") as f:
            return "raspberry pi" in f.read().lower()
    except Exception:
        return False
# Wird vom taeglichen Update-Check-Timer geschrieben - hier nur best-effort
# mitgelesen, um im Frontend einen kleinen Hinweis anzuzeigen, ohne selbst
# GitHub kontaktieren zu muessen. Liegt seit dem Portal-Umbau in einem
# App-eigenen Unterordner (state/<app-id>/), da das Portal jetzt mehrere
# Apps (z. B. auch HonigBox) gleichzeitig verwalten kann.
UPDATE_CHECK_STATE_PATH = os.path.join(PI_MARKER_DIR, "state", "imkerei", "update_check.json")
# Vom root-Skript setup/imkerei-systemneustart.py geschrieben (siehe /api/systemupdate).
SYSTEMUPDATE_STATUS_PATH = os.path.join(DATA_DIR, ".systemupdate-status.json")
# Gleicher Pfad wie BACKUP_DIR im Setup-Portal (setup_portal.py) - der
# taegliche Backup-Timer legt dort Archive ab, ohne ueber /api/backup zu
# laufen. Wird hier nur mitgelesen, um "gibt es ein aktuelles Backup?" auch
# fuer die naechtlichen Pi-Backups zu erkennen (nicht nur JSON-Exports).
BACKUP_DIR = "/opt/backup"
BACKUP_NAME_RE = re.compile(r"^imkerei-backup-[0-9-]+\.tar\.gz$")
BACKUP_GRACE_DAYS = 3
USB_MOUNT = "/mnt/backup-usb"
# install.sh legt diese Datei nur an, wenn Port 80 beim Einrichten schon
# belegt war und das Setup-Portal stattdessen auf einem Ausweich-Port laeuft
# (siehe setup-portal.service). Wird hier mitgelesen, damit das Frontend
# Links zur Setup-/Backup-Seite mit dem richtigen Port bauen kann - ohne
# Port 80 fest anzunehmen, laeuft dort sonst ins Leere.
LANDING_PORT_ENV_PATH = "/etc/default/setup-portal"


def landing_port():
    try:
        with open(LANDING_PORT_ENV_PATH) as f:
            content = f.read()
        m = re.search(r"^SETUP_PORTAL_LANDING_PORT=(\d+)", content, re.MULTILINE)
        if m:
            return int(m.group(1))
    except Exception:
        pass
    return 80

os.makedirs(PHOTO_DIR, exist_ok=True)
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
BACKUP_FOTO_RE = re.compile(r"^photos/[A-Za-z0-9_-]{1,40}\.jpg$")
RESTORE_MAX_BYTES = 4 * 1024**3
UPLOAD_MAX_BYTES = 25 * 1024**2   # einzelnes Foto bzw. Logo
# Einmalige Startbelegung fuer honey_products (Name, Preis in Euro, Gewicht in Gramm, Button-Farbe) -
# entspricht den in der bisher genutzten Excel-Liste tatsaechlich verwendeten Sorten/Groessen.
DEFAULT_HONEY_PRODUCTS = [
    ("Raps 500g", 9.0, 500, "#ffffff"),
    ("Raps 250g", 6.0, 250, "#ffffff"),
    ("Frühtracht 500g", 9.0, 500, "#ffd43b"),
    ("Frühtracht 250g", 6.0, 250, "#ffd43b"),
    ("Sommertracht 500g", 9.0, 500, "#e8590c"),
    ("Sommertracht 250g", 6.0, 250, "#e8590c"),
    ("Sommertracht flüssig 500g", 9.0, 500, "#8b0000"),
    ("Sommertracht flüssig 250g", 6.0, 250, "#8b0000"),
]
# Feste sortOrder-Zuordnung fuer die Standard-Produkte (Raps, Fruehtracht, Sommertracht,
# Sommertracht fluessig - in dieser Reihenfolge) - wird bei jedem Start erneut angewendet,
# damit sie auch bei bereits existierenden Installationen (vor dieser Reihenfolge angelegt)
# korrigiert wird. Neu angelegte eigene Produkte bekommen ueber maxSort+1 weiterhin einen
# hoeheren Wert und landen damit automatisch darunter.
HONEY_PRODUCT_SORTORDER_BY_NAME = {name: i for i, (name, *_rest) in enumerate(DEFAULT_HONEY_PRODUCTS)}
# Nach Namens-Praefix, um Farben auch bei bereits vorhandenen (aelteren) Produkten
# nachtraeglich zu setzen (siehe Migration/Backfill in init_db()) - Reihenfolge wichtig:
# "Sommertracht fluessig" muss VOR dem allgemeineren "Sommertracht" stehen, sonst
# wuerde die generischere Regel zuerst zuschlagen (beide Namen teilen das Praefix).
HONEY_PRODUCT_COLOR_BY_PREFIX = [
    ("Frühtracht", "#ffd43b"),
    ("Sommertracht flüssig", "#8b0000"),
    ("Sommertracht", "#e8590c"),
    ("Raps", "#ffffff"),
]
# Diese Standard-Sorten gelten als "honig" (kind), alles andere per Default als
# "sonstige" - siehe Backfill in init_db().
HONEY_PRODUCT_HONIG_NAMES = set(name for name, *_rest in DEFAULT_HONEY_PRODUCTS)

def now_iso(): return datetime.now(timezone.utc).isoformat()
def new_id():  return secrets.token_hex(8)

def last_backup_at(con):
    """Zeitpunkt des juengsten bekannten Backups (JSON-Export ueber die App
    ODER - falls Pi-Installation - das juengste automatische Archiv unter
    BACKUP_DIR), oder None falls keins bekannt ist."""
    latest=None
    row=con.execute("SELECT value FROM settings WHERE key='_lastBackupAt'").fetchone()
    if row and row["value"]:
        try: latest=datetime.fromisoformat(row["value"])
        except Exception: pass
    if os.path.isdir(PI_MARKER_DIR):
        try:
            for name in os.listdir(BACKUP_DIR):
                if not BACKUP_NAME_RE.match(name): continue
                mtime=datetime.fromtimestamp(os.path.getmtime(os.path.join(BACKUP_DIR,name)),tz=timezone.utc)
                if latest is None or mtime>latest: latest=mtime
        except Exception: pass
    return latest

def has_recent_backup(con):
    dt=last_backup_at(con)
    if dt is None: return False
    if dt.tzinfo is None: dt=dt.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc)-dt)<=timedelta(days=BACKUP_GRACE_DAYS)
class _Verbindung(sqlite3.Connection):
    """Datenbankverbindung, die zu loeschende Foto-Dateien erst NACH einem
    erfolgreichen commit() entfernt (seit v2.9.60). Vorher wurden die Dateien
    vor dem commit geloescht - scheiterte das Speichern danach, war das Foto
    weg, der Eintrag zeigte aber noch darauf."""
    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        self.dateien_nach_commit = []

    def commit(self):
        super().commit()
        weg, self.dateien_nach_commit = self.dateien_nach_commit, []
        for pfad in weg:
            try: os.remove(pfad)
            except FileNotFoundError: pass

    def rollback(self):
        self.dateien_nach_commit = []
        super().rollback()


def db():
    con = sqlite3.connect(DB_PATH, factory=_Verbindung)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    con.execute("PRAGMA journal_mode = WAL")
    con.execute("PRAGMA synchronous = NORMAL")
    return con
def column_exists(con, table, col):
    return any(r[1]==col for r in con.execute(f"PRAGMA table_info({table})").fetchall())

# ---------------------------------------------------------------------------
# Spalten-Definition: EINE Stelle pro Spalte (seit v2.9.59). Daraus entstehen
# CREATE TABLE, die Migration (fehlende Spalten per ALTER TABLE), Neuanlage
# (POST), Speichern (PUT) und Wiederherstellen (Restore). Vorher stand jede
# Spalte an bis zu fuenf Stellen - eine vergessene Stelle im Restore haette
# Daten beim Zurueckspielen eines Backups still verschwinden lassen.
#
# Neue Spalte = eine Zeile hier. Sonderfaelle (Zeitstempel, Standardwerte aus
# Einstellungen, Foto-Aufraeumen) stehen in den POST/PUT/Restore-Hooks unten.
# ---------------------------------------------------------------------------
class Sp:
    """Eine Spalte.
    art:     text | int | float | bool | json  (Umwandlung des Werts aus dem JSON-Body)
    std:     Wert, wenn die Spalte im Body/Backup fehlt
    streng:  bei POST/PUT kein "or 0" - leerer Wert gibt 400 (Restore bleibt nachsichtig)
    alt:     Altspalte - nur noch in der Tabelle, nie aus Body/Backup gesetzt
    nur_wenn_gesendet: PUT aendert die Spalte nur, wenn sie im Body steht"""
    __slots__ = ("name", "typ", "sql_default", "art", "std", "streng", "alt", "nur_wenn_gesendet")

    def __init__(self, name, typ="TEXT", sql_default=None, art="text", std="",
                 streng=False, alt=False, nur_wenn_gesendet=False):
        self.name, self.typ, self.sql_default, self.art, self.std = name, typ, sql_default, art, std
        self.streng, self.alt, self.nur_wenn_gesendet = streng, alt, nur_wenn_gesendet


def _int(name, default=0, **kw):
    return Sp(name, "INTEGER", None if default is None else str(default), "int", 0, **kw)

def _json(name, std, sql_default=None, **kw):
    return Sp(name, "TEXT", sql_default, "json", std, **kw)


SCHEMA = {
    "apiaries": [Sp("id"), Sp("name"), Sp("location"), Sp("notes"), Sp("createdAt")],
    "colonies": [
        Sp("id"), Sp("apiaryId"), Sp("name"), Sp("queenYear"), Sp("queenNr"), Sp("queenGen"),
        Sp("status", std="ok"), Sp("source"), Sp("notes"), Sp("scaleId"),
        _int("sortOrder"), Sp("createdAt"), _int("archived"), Sp("archivedAt", std=None),
        Sp("demareeStage"), Sp("demareedAt"), Sp("demareeEndedAt"),
        _int("requeueFlag"), Sp("requeueReasons", std="[]"), Sp("requeueNote"), _int("breedFlag"),
        Sp("honigRaeume", std="[]"), Sp("umlarvDate"), Sp("weiselprobeDate"), Sp("kaefigungDate"),
        Sp("koeniginFreiDate"), Sp("currentWeight"), Sp("currentWeightDate"), Sp("zielGewicht"),
        Sp("oxalBlockStage"), Sp("oxalBlockStartAt"), Sp("oxalBlockLastAt"),
    ],
    "entries": [
        Sp("id"), Sp("colonyId"), Sp("date"), Sp("type"), Sp("notes"),
        Sp("photoIds", alt=True),  # vor "photos"; init_db() und entry_photos() werten sie noch aus
        _json("obs", []), _json("photos", []), _json("obs_extra", {}),
        Sp("temper"), Sp("strength"), Sp("food"), Sp("demareeAction"), Sp("entryHrNr"),
        Sp("oxalBlockAction"), Sp("varroaCount"), _int("varroaAnts"), Sp("createdAt"),
    ],
    "scales": [Sp("id"), Sp("name"), Sp("url"), Sp("notes"), Sp("createdAt")],
    "trachten": [Sp("id"), Sp("name"), Sp("createdAt")],
    "reminders": [
        Sp("id"), Sp("text"), Sp("apiaryId"), Sp("apiaryName"), Sp("createdAt"), Sp("dueDate"),
        _int("remindDaysBefore"), Sp("repeatMode", sql_default="'none'", std="none"),
        _json("repeatWeekdays", [], "'[]'"), _int("repeatIntervalWeeks"), _int("repeatMonthDay"),
        _json("autoRefs", [], "'[]'", nur_wenn_gesendet=True),
    ],
    "honey_harvests": [
        Sp("id"), _int("year", None, streng=True), Sp("tracht"),
        Sp("menge", "REAL", None, "float", 0, streng=True), Sp("notizen"),
        Sp("apiaryId"), Sp("apiaryName"), _int("anzahlVoelker"), Sp("createdAt"),
    ],
    "sirup_calc": [Sp("id"), Sp("date"), Sp("ratio"), Sp("mode"), Sp("inputValue"), Sp("sugar"),
                   Sp("water"), Sp("result"), Sp("createdAt")],
    "honey_stir_batches": [
        Sp("id"), Sp("honeyType"), Sp("amountKg"), Sp("seedDate"), Sp("seedTemp"), Sp("seedAmountG"),
        Sp("seedHoneyType"), Sp("status", sql_default="'active'", std="active"), Sp("conclusion"),
        Sp("createdAt"),
    ],
    "honey_stir_entries": [Sp("id"), Sp("batchId"), Sp("date"), Sp("temp"), Sp("appearance"),
                           _json("photos", []), Sp("notes"), Sp("createdAt")],
    "honey_products": [
        Sp("id"), Sp("name"), Sp("price", "REAL", "0", "float", 0), _int("sizeGrams"),
        Sp("active", "INTEGER", "1", "bool", True), _int("sortOrder"),
        Sp("color", sql_default="''"), Sp("kind", sql_default="'sonstige'", std="sonstige"),
        _int("giftSetVarieties"), _json("giftSetProductIds", [], "'[]'"), Sp("createdAt"),
    ],
    "honey_sales": [Sp("id"), Sp("date"), Sp("category"), Sp("buyerName"), _json("items", []),
                    Sp("total", "REAL", "0", "float", 0), Sp("notes"), Sp("createdAt"), Sp("updatedAt")],
    "honey_costs": [Sp("id"), Sp("date"), Sp("description"), Sp("supplier"),
                    Sp("amount", "REAL", "0", "float", 0), Sp("notes"), Sp("createdAt"), Sp("updatedAt")],
}

# Spalten, die PUT nie anfasst (zusaetzlich zu id und Altspalten)
PUT_OHNE = {
    "colonies": {"archived", "archivedAt", "sortOrder", "createdAt"},  # eigene Endpunkte
    "entries": {"colonyId", "createdAt"},                              # Formular schickt colonyId nicht
    "honey_stir_entries": {"batchId", "createdAt"},
}
PUT_OHNE_STANDARD = {"createdAt"}
# Tabellen, bei denen PUT nur mitgeschickte Felder aendert (sonst: fehlend = Standardwert)
PUT_TEILWEISE = {"colonies"}
# Tabellen ohne PUT-Endpunkt
PUT_GESPERRT = {"sirup_calc"}
# Bei diesen Tabellen setzt der Server createdAt bei der Neuanlage selbst
POST_CREATED_JETZT = {"scales", "trachten", "honey_harvests", "honey_stir_batches",
                      "honey_stir_entries", "honey_products", "honey_sales", "honey_costs"}


def _umwandeln(sp, v, streng):
    if sp.art == "text": return v
    if sp.art == "json": return json.dumps(sp.std if v is None else v)  # null -> [] bzw. {}
    if sp.art == "bool": return 1 if v else 0
    if sp.art == "int":  return int(v) if streng else int(v or 0)
    if sp.art == "float": return float(v) if streng else float(v or 0)
    raise ValueError(sp.art)


def _spalten(tabelle, ohne=()):
    return [sp for sp in SCHEMA[tabelle] if sp.name != "id" and not sp.alt and sp.name not in ohne]


def werte_aus_body(tabelle, body, modus):
    """modus: "post" | "put" | "restore". Liefert {spalte: umgewandelter Wert}."""
    if modus == "put":
        ohne = PUT_OHNE.get(tabelle, PUT_OHNE_STANDARD)
        teilweise = tabelle in PUT_TEILWEISE
    else:
        ohne, teilweise = (), False
    werte = {}
    for sp in _spalten(tabelle, ohne):
        if (teilweise or (modus == "put" and sp.nur_wenn_gesendet)) and sp.name not in body:
            continue
        werte[sp.name] = _umwandeln(sp, body.get(sp.name, sp.std), sp.streng and modus != "restore")
    return werte


def zeile_einfuegen(con, tabelle, werte):
    namen = list(werte)
    con.execute(f"INSERT INTO {tabelle}({','.join(namen)}) VALUES({','.join('?' * len(namen))})",
                [werte[n] for n in namen])


def zeile_aendern(con, tabelle, rid, werte):
    if not werte: return
    namen = list(werte)
    con.execute(f"UPDATE {tabelle} SET {','.join(n + '=?' for n in namen)} WHERE id=?",
                [werte[n] for n in namen] + [rid])


def _spalten_sql(sp):
    if sp.name == "id": return "id TEXT PRIMARY KEY"
    return f"{sp.name} {sp.typ}" + (f" DEFAULT {sp.sql_default}" if sp.sql_default is not None else "")


def init_db():
    con = db()
    for tabelle, spalten in SCHEMA.items():
        con.execute(f"CREATE TABLE IF NOT EXISTS {tabelle}({', '.join(_spalten_sql(sp) for sp in spalten)})")
        # Migration: jede in SCHEMA definierte, aber fehlende Spalte ergaenzen
        for sp in spalten:
            if sp.name != "id" and not column_exists(con, tabelle, sp.name):
                con.execute(f"ALTER TABLE {tabelle} ADD COLUMN {_spalten_sql(sp)}")
    con.executescript("""
        CREATE TABLE IF NOT EXISTS settings(
            key TEXT PRIMARY KEY, value TEXT);
        CREATE INDEX IF NOT EXISTS idx_col_apiary ON colonies(apiaryId);
        CREATE INDEX IF NOT EXISTS idx_ent_colony ON entries(colonyId);
        CREATE INDEX IF NOT EXISTS idx_stirentry_batch ON honey_stir_entries(batchId);
    """)
    # Bestehende Zeilen ohne updatedAt (vor Einfuehrung dieser Spalte) auf ihr createdAt setzen,
    # damit die "Geaendert"-Spalte nicht leer bleibt.
    con.execute("UPDATE honey_sales SET updatedAt=createdAt WHERE updatedAt IS NULL")
    con.execute("UPDATE honey_costs SET updatedAt=createdAt WHERE updatedAt IS NULL")
    if con.execute("SELECT COUNT(*) FROM honey_products").fetchone()[0] == 0:
        for i, (name, price, grams, color) in enumerate(DEFAULT_HONEY_PRODUCTS):
            con.execute("INSERT INTO honey_products(id,name,price,sizeGrams,active,sortOrder,color,kind,createdAt) VALUES(?,?,?,?,1,?,?,'honig',?)",
                (new_id(), name, price, grams, i, color, now_iso()))
    if con.execute("SELECT COUNT(*) FROM trachten").fetchone()[0] == 0:
        for name in ("Frühtracht","Sommertracht","Rapshonig"):
            con.execute("INSERT INTO trachten(id,name,createdAt) VALUES(?,?,?)", (new_id(), name, now_iso()))
    # Farben auch fuer bereits vorhandene Standard-Produkte nachtragen (z.B. nach Upgrade
    # von einer Version ohne Farb-Spalte), aber keine vom Nutzer bewusst geloeschte Farbe ueberschreiben.
    for prefix, color in HONEY_PRODUCT_COLOR_BY_PREFIX:
        con.execute("UPDATE honey_products SET color=? WHERE (color IS NULL OR color='') AND name LIKE ?",
            (color, prefix+'%'))
    for name, order in HONEY_PRODUCT_SORTORDER_BY_NAME.items():
        con.execute("UPDATE honey_products SET sortOrder=? WHERE name=?", (order, name))
    # Standard-Sorten immer als "honig" markieren (auch bei Upgrade von einer Version ohne
    # kind-Spalte) - alle anderen (eigene) Produkte bleiben beim Default "sonstige".
    for name in HONEY_PRODUCT_HONIG_NAMES:
        con.execute("UPDATE honey_products SET kind='honig' WHERE name=?", (name,))
    if column_exists(con,"entries","photoIds"):
        for r in con.execute("SELECT id, photoIds FROM entries WHERE photos IS NULL").fetchall():
            try: ids = json.loads(r["photoIds"] or "[]")
            except: ids = []
            con.execute("UPDATE entries SET photos=? WHERE id=?",
                        (json.dumps([{"id":p,"caption":""} for p in ids]), r["id"]))
    con.commit(); con.close()

def rows(con, sql, args=()):
    return [dict(r) for r in con.execute(sql, args).fetchall()]

def parse_entry(r):
    photos = entry_photos(r); d = dict(r)
    try: d["obs"] = json.loads(d.get("obs") or "[]")
    except: d["obs"] = []
    try: d["obs_extra"] = json.loads(d.get("obs_extra") or "{}")
    except: d["obs_extra"] = {}
    d["photos"] = photos; d.pop("photoIds", None)
    return d

def parse_stir_entry(r):
    d = dict(r)
    try: d["photos"] = json.loads(d.get("photos") or "[]")
    except Exception: d["photos"] = []
    return d

def parse_sale(r):
    d = dict(r)
    try: d["items"] = json.loads(d.get("items") or "[]")
    except Exception: d["items"] = []
    return d

def parse_product(r):
    d = dict(r)
    try: d["giftSetProductIds"] = json.loads(d.get("giftSetProductIds") or "[]")
    except Exception: d["giftSetProductIds"] = []
    return d

def parse_reminder(r):
    d = dict(r)
    try: d["repeatWeekdays"] = json.loads(d.get("repeatWeekdays") or "[]")
    except Exception: d["repeatWeekdays"] = []
    try: d["autoRefs"] = json.loads(d.get("autoRefs") or "[]")
    except Exception: d["autoRefs"] = []
    return d

def photo_ids(photos):
    return [p.get("id") for p in (photos or []) if isinstance(p,dict) and p.get("id")]

def entry_photos(row):
    try: raw = row["photos"]
    except: raw = None
    if raw:
        try: photos = json.loads(raw)
        except: photos = []
        if photos: return photos
    try: rawi = row["photoIds"]
    except: rawi = None
    if rawi:
        try: return [{"id":p,"caption":""} for p in json.loads(rawi)]
        except: pass
    return []

def referenced_photo_ids(con):
    refs=set()
    for r in con.execute("SELECT photos,photoIds FROM entries").fetchall():
        refs.update(photo_ids(entry_photos(r)))
    for r in con.execute("SELECT photos FROM honey_stir_entries").fetchall():
        try: refs.update(photo_ids(json.loads(r["photos"] or "[]")))
        except Exception: pass
    return refs

def delete_photos(con, ids):
    # Erst NACH der DB-Aenderung aufrufen: merkt nur Dateien zum Loeschen vor,
    # auf die kein Eintrag mehr zeigt. Ein per "Foto verschieben" an einen
    # anderen Eintrag gehaengtes Foto bleibt so erhalten, auch wenn der alte
    # Eintrag es abgibt. Geloescht wird erst beim commit() (siehe _Verbindung).
    ids=[p for p in (ids or []) if ID_RE.match(str(p))]
    if not ids: return
    refs=referenced_photo_ids(con)
    for pid in ids:
        if pid in refs: continue
        con.dateien_nach_commit.append(os.path.join(PHOTO_DIR, pid+".jpg"))

def delete_colony_cascade(con, cid):
    ids=[]
    for e in con.execute("SELECT photos,photoIds FROM entries WHERE colonyId=?",(cid,)).fetchall():
        ids+=photo_ids(entry_photos(e))
    con.execute("DELETE FROM entries WHERE colonyId=?",(cid,))
    con.execute("DELETE FROM colonies WHERE id=?",(cid,))
    delete_photos(con, ids)



class Handler(BaseHTTPRequestHandler):
    server_version = "BeeTown"

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type","application/json; charset=utf-8")
        self.send_header("Content-Length",str(len(body)))
        self.end_headers(); self.wfile.write(body)

    def _bytes(self, data, ct, code=200, cache=False):
        self.send_response(code)
        self.send_header("Content-Type",ct)
        self.send_header("Content-Length",str(len(data)))
        if cache: self.send_header("Cache-Control","public,max-age=31536000,immutable")
        self.end_headers(); self.wfile.write(data)

    def _err(self, code, msg): self._json({"error":msg}, code)

    def send_response(self, code, message=None):
        self._antwort_begonnen=True
        super().send_response(code, message)

    def _api(self, fn, path):
        """Ruft einen API-Handler auf und macht aus einer Ausnahme eine saubere
        JSON-Fehlerantwort. Vorher brach der Server bei z.B. int("") einfach die
        Verbindung ab, und die App meldete "Server nicht erreichbar - VPN?"."""
        self._antwort_begonnen=False
        try:
            return fn(path)
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            if self._antwort_begonnen: return
            if isinstance(e,(ValueError,TypeError,KeyError)):
                return self._err(400, f"Ungültige Eingabe ({type(e).__name__}: {e})")
            return self._err(500, f"Interner Serverfehler ({type(e).__name__}) – Details im Journal")

    def _rjson(self):
        n=int(self.headers.get("Content-Length",0))
        return json.loads(self.rfile.read(n).decode()) if n>0 else {}

    def _upload_zu_gross(self, grenze):
        """True (und 413 gesendet), wenn der Upload groesser als `grenze` ist.
        Der Rest der Anfrage wird nicht gelesen - deshalb Verbindung schliessen."""
        if int(self.headers.get("Content-Length",0) or 0) <= grenze: return False
        self.close_connection=True
        self._err(413, f"Datei zu groß (höchstens {grenze // (1024*1024)} MB)")
        return True

    def _rraw(self):
        n=int(self.headers.get("Content-Length",0))
        return self.rfile.read(n) if n>0 else b""

    def _rform(self):
        """Wie _rjson(), aber fuer normale HTML-<form>-POSTs (Login/
        Ersteinrichtung/Reset) - die schicken application/x-www-form-urlencoded,
        kein JSON."""
        from urllib.parse import parse_qs
        n=int(self.headers.get("Content-Length",0))
        if n<=0: return {}
        try:
            rohdaten=self.rfile.read(n).decode()
            return {k:v[0] for k,v in parse_qs(rohdaten).items()}
        except (UnicodeDecodeError, ValueError):
            return {}

    def _html(self, text, code=200):
        body=text.encode()
        self.send_response(code)
        self.send_header("Content-Type","text/html; charset=utf-8")
        self.send_header("Content-Length",str(len(body)))
        self.end_headers(); self.wfile.write(body)

    def _redirect(self, ziel):
        self.send_response(302)
        self.send_header("Location", ziel)
        self.send_header("Content-Length","0")
        self.end_headers()

    def _zugang_pruefen(self):
        """None = Ersteinrichtung noetig, True = eingeloggt/kein Schutz, False = Login noetig."""
        if ZUGANG_DEAKTIVIERT or zugang_per_einstellung_deaktiviert():
            return True
        if not zugang_eingerichtet():
            return None
        return zugang_cookie_gueltig(self.headers.get("Cookie"))

    def _setze_zugang_cookie_und_redirect(self, ziel):
        wert=_zugang_cookie_sollwert()
        self.send_response(302)
        self.send_header("Location", ziel)
        self.send_header("Set-Cookie",
            f"{ZUGANG_COOKIE_NAME}={wert}; Max-Age={ZUGANG_COOKIE_MAX_AGE}; Path=/; HttpOnly; SameSite=Lax")
        self.send_header("Content-Length","0")
        self.end_headers()

    def _post_einrichten(self):
        if zugang_eingerichtet(): return self._redirect("/")
        form=self._rform()
        passwort=form.get("passwort","")
        if passwort!=form.get("passwort2",""):
            return self._html(_seite_einrichten("Die beiden Passwörter stimmen nicht überein."))
        try:
            setze_zugang_passwort(passwort)
        except ValueError as e:
            return self._html(_seite_einrichten(str(e)))
        self._setze_zugang_cookie_und_redirect("/")

    def _post_login(self):
        if not zugang_eingerichtet(): return self._redirect("/einrichten")
        form=self._rform()
        if not pruefe_zugang_passwort(form.get("passwort","")):
            time.sleep(0.3)  # winziger Bremsklotz gegen automatisiertes Durchprobieren
            return self._html(_seite_login("Falsches Passwort."))
        self._setze_zugang_cookie_und_redirect("/")

    def _post_zuruecksetzen(self):
        if not zugang_eingerichtet(): return self._redirect("/einrichten")
        if not zugang_reset_moeglich(): return self._redirect("/login")
        form=self._rform()
        passwort=form.get("passwort","")
        if passwort!=form.get("passwort2",""):
            return self._html(_seite_zuruecksetzen("Die beiden Passwörter stimmen nicht überein."))
        try:
            setze_zugang_passwort(passwort)
        except ValueError as e:
            return self._html(_seite_zuruecksetzen(str(e)))
        self._setze_zugang_cookie_und_redirect("/")

    def do_HEAD(self):
        if self.path == "/api/logo":
            if os.path.isfile(LOGO_PATH):
                self.send_response(200)
                self.send_header("Content-Type","image/jpeg")
                self.end_headers()
            else:
                self.send_response(404)
                self.end_headers()
        else:
            self.send_response(404)
            self.end_headers()

    def do_GET(self):
        p=self.path.split("?",1)[0]
        # styles.css muss auch ohne Zugangs-Cookie erreichbar sein, sonst
        # liesse sich die Login-/Ersteinrichtungs-Seite selbst nicht stylen.
        if p=="/styles.css": return self.serve_static(p)
        # Service-Worker, Manifest und Icons enthalten keine Daten. Ohne Login
        # erreichbar, damit eine installierte PWA sich auch nach abgelaufenem
        # Cookie aktualisieren kann (ein Service-Worker-Skript darf nicht auf
        # /login umgeleitet werden, sonst schlaegt jedes SW-Update fehl).
        if p in ("/sw.js","/manifest.json","/icon-192.png","/icon-512.png"): return self.serve_static(p)
        zugang=self._zugang_pruefen()
        if p=="/einrichten":
            if zugang_eingerichtet(): return self._redirect("/")
            return self._html(_seite_einrichten())
        if p=="/login":
            if zugang is None: return self._redirect("/einrichten")
            if zugang is True: return self._redirect("/")
            return self._html(_seite_login())
        if p=="/zuruecksetzen":
            if not zugang_eingerichtet(): return self._redirect("/einrichten")
            if not zugang_reset_moeglich(): return self._redirect("/login")
            return self._html(_seite_zuruecksetzen())
        # API-Abfragen ohne Login bekommen 401 statt einer Umleitung: fetch()
        # wuerde der Umleitung folgen und die Login-Seite als "Daten" erhalten,
        # die App erkennt am 401, dass sie zur Anmeldung wechseln muss.
        if p.startswith("/api/") and zugang is not True: return self._err(401,"Nicht angemeldet")
        if zugang is None: return self._redirect("/einrichten")
        if zugang is False: return self._redirect("/login")
        if p.startswith("/api/"): return self._api(self.api_get, p)
        self.serve_static(p)

    def do_POST(self):
        p=self.path.split("?",1)[0]
        if p=="/einrichten": return self._post_einrichten()
        if p=="/login": return self._post_login()
        if p=="/zuruecksetzen": return self._post_zuruecksetzen()
        zugang=self._zugang_pruefen()
        if zugang is None: return self._redirect("/einrichten")
        if zugang is False: return self._err(403,"Nicht angemeldet")
        if p.startswith("/api/"): return self._api(self.api_post, p)
        self._err(404,"Not found")

    def do_PUT(self):
        zugang=self._zugang_pruefen()
        if zugang is not True: return self._err(403,"Nicht angemeldet")
        if self.path.startswith("/api/"): return self._api(self.api_put, self.path)
        self._err(404,"Not found")

    def do_DELETE(self):
        zugang=self._zugang_pruefen()
        if zugang is not True: return self._err(403,"Nicht angemeldet")
        if self.path.startswith("/api/"): return self._api(self.api_delete, self.path)
        self._err(404,"Not found")

    def serve_static(self, path):
        if path in ("/",""): path="/index.html"
        rel=path.lstrip("/")
        basis=os.path.abspath(STATIC_DIR)
        full=os.path.abspath(os.path.join(basis,rel))
        # commonpath statt startswith: "/opt/imkerei/static2" beginnt auch mit ".../static"
        if os.path.commonpath([full,basis])!=basis or not os.path.isfile(full):
            return self._err(404,"Not found")
        ct=mimetypes.guess_type(full)[0] or "application/octet-stream"
        with open(full,"rb") as f: self._bytes(f.read(),ct)

    def api_get(self, path):
        if path=="/api/systemupdate":
            # Status des naechtlichen Systemupdate-Checks (setup/imkerei-systemneustart.py,
            # laeuft als root und schreibt die Datei - der Dienst liest nur). Nur auf
            # einem Raspberry Pi relevant; "honigbox": HonigBox auf derselben Box
            # steuert dann den Neustart.
            status={}
            try:
                with open(SYSTEMUPDATE_STATUS_PATH) as f:
                    status=json.load(f)
            except Exception:
                pass
            return self._json({"pi":_is_raspberry_pi(),
                               "honigbox":os.path.exists("/opt/honigbox/systemneustart.py"),
                               "status":status})
        if path=="/api/platform":
            is_pi=_is_raspberry_pi()
            has_setup_portal=os.path.isdir(PI_MARKER_DIR)
            # Update-Check laeuft auf Pi UND Linux-Server gleichermassen
            # (setup/install.sh richtet das Setup-Portal fuer beide ein) -
            # daher an has_setup_portal haengen, nicht an is_pi, sonst wuerde
            # das Update-Badge auf einem Linux-Server nie erscheinen.
            update_available=False
            latest_version=None
            latest_version_notes=None
            auto_updated_version=None
            if has_setup_portal:
                try:
                    with open(UPDATE_CHECK_STATE_PATH) as f:
                        state=json.load(f)
                    update_available=bool(state.get("update_available"))
                    latest_version=state.get("latest")
                    latest_version_notes=state.get("notes")
                    auto_updated_version=state.get("auto_updated_version")
                except Exception:
                    pass
            # USB-Backup-Sorge ist Pi-spezifisch (SD-Karte als Single Point
            # of Failure) - auf einem Linux-Server kein Thema.
            usb_backup_missing=is_pi and not os.path.ismount(USB_MOUNT)
            con=db()
            try:
                recent_backup=has_recent_backup(con)
                last_backup=last_backup_at(con)
            finally:
                con.close()
            return self._json({
                "pi": is_pi,
                "setupPortal": has_setup_portal,
                "updateAvailable": update_available,
                "latestVersion": latest_version,
                "latestVersionNotes": latest_version_notes,
                "autoUpdatedVersion": auto_updated_version,
                "usbBackupMissing": usb_backup_missing,
                "recentBackup": recent_backup,
                "lastBackupAt": last_backup.isoformat() if last_backup else None,
                "landingPort": landing_port(),
            })
        if path=="/api/logo":
            if not os.path.isfile(LOGO_PATH): return self._err(404,"Kein Logo")
            with open(LOGO_PATH,"rb") as f: data=f.read()
            return self._bytes(data,"image/jpeg")
        from urllib.parse import urlparse, parse_qs
        q=parse_qs(urlparse(self.path).query); con=db()
        try:
            if path=="/api/apiaries":
                return self._json(rows(con,"SELECT * FROM apiaries ORDER BY name"))
            if path=="/api/colonies":
                aid=(q.get("apiaryId") or [""])[0]
                return self._json(rows(con,
                    "SELECT * FROM colonies WHERE apiaryId=? AND archived=0 ORDER BY sortOrder,name",(aid,)))
            if path=="/api/archive":
                return self._json(rows(con,"""
                    SELECT c.*,a.name AS apiaryName FROM colonies c
                    LEFT JOIN apiaries a ON a.id=c.apiaryId
                    WHERE c.archived=1 ORDER BY c.archivedAt DESC,c.name"""))
            if path=="/api/entries":
                cid=(q.get("colonyId") or [""])[0]
                return self._json([parse_entry(r) for r in
                    con.execute("SELECT * FROM entries WHERE colonyId=? ORDER BY date DESC, createdAt DESC",(cid,)).fetchall()])
            if path=="/api/entries/varroa":
                rs=con.execute("""
                    SELECT e.*, c.name AS colonyName, c.apiaryId AS apiaryId, a.name AS apiaryName
                    FROM entries e
                    JOIN colonies c ON c.id = e.colonyId
                    LEFT JOIN apiaries a ON a.id = c.apiaryId
                    WHERE e.varroaCount IS NOT NULL AND e.varroaCount != ''
                    ORDER BY e.date DESC, e.createdAt DESC
                """).fetchall()
                return self._json([parse_entry(r) for r in rs])
            if path=="/api/entries/all":
                rs=con.execute("""
                    SELECT e.*, c.name AS colonyName, c.apiaryId AS apiaryId, a.name AS apiaryName
                    FROM entries e
                    JOIN colonies c ON c.id = e.colonyId
                    LEFT JOIN apiaries a ON a.id = c.apiaryId
                    ORDER BY e.date DESC, e.createdAt DESC
                """).fetchall()
                return self._json([parse_entry(r) for r in rs])
            if path=="/api/entries/latest":
                try:
                    limit=int((q.get("limit") or ["90"])[0])
                except ValueError:
                    limit=90
                if limit<=0: limit=90
                rs=con.execute("""
                    SELECT e.*, c.name AS colonyName, c.apiaryId AS apiaryId, a.name AS apiaryName
                    FROM entries e
                    JOIN colonies c ON c.id = e.colonyId
                    LEFT JOIN apiaries a ON a.id = c.apiaryId
                    WHERE c.archived = 0
                    ORDER BY e.date DESC, e.createdAt DESC
                    LIMIT ?
                """,(limit,)).fetchall()
                return self._json([parse_entry(r) for r in rs])
            if path=="/api/scales":
                return self._json(rows(con,"SELECT * FROM scales ORDER BY name"))
            if path=="/api/trachten":
                return self._json(rows(con,"SELECT * FROM trachten ORDER BY name"))
            if path=="/api/settings":
                r=con.execute("SELECT key,value FROM settings").fetchall()
                return self._json({row[0]:row[1] for row in r})
            if path=="/api/reminders":
                return self._json([parse_reminder(r) for r in con.execute("SELECT * FROM reminders ORDER BY createdAt DESC").fetchall()])
            if path=="/api/honey_harvests":
                return self._json(rows(con,"SELECT * FROM honey_harvests ORDER BY year DESC, createdAt DESC"))
            if path=="/api/sirup_calc":
                return self._json(rows(con,"SELECT * FROM sirup_calc ORDER BY createdAt DESC LIMIT 20"))
            if path=="/api/honey_stir_batches":
                return self._json(rows(con,"SELECT * FROM honey_stir_batches ORDER BY seedDate DESC"))
            if path=="/api/honey_stir_entries":
                bid=(q.get("batchId") or [""])[0]
                rs=con.execute("SELECT * FROM honey_stir_entries WHERE batchId=? ORDER BY date DESC",(bid,)).fetchall()
                return self._json([parse_stir_entry(r) for r in rs])
            if path=="/api/honey_products":
                return self._json([parse_product(r) for r in con.execute("SELECT * FROM honey_products ORDER BY sortOrder,name").fetchall()])
            if path=="/api/honey_sales":
                rs=con.execute("SELECT * FROM honey_sales ORDER BY date DESC, createdAt DESC").fetchall()
                return self._json([parse_sale(r) for r in rs])
            if path=="/api/honey_costs":
                return self._json(rows(con,"SELECT * FROM honey_costs ORDER BY date DESC, createdAt DESC"))
            if path=="/api/backup": return self.api_backup(con,(q.get("format") or [""])[0])
            m=re.match(r"^/api/photos/([^/]+)$",path)
            if m:
                pid=m.group(1)
                if not ID_RE.match(pid): return self._err(400,"Bad id")
                fp=os.path.join(PHOTO_DIR,pid+".jpg")
                if not os.path.isfile(fp): return self._err(404,"Not found")
                with open(fp,"rb") as f: return self._bytes(f.read(),"image/jpeg",cache=True)
            m=re.match(r"^/api/colonies/([^/]+)$",path)
            if m:
                r=con.execute("SELECT * FROM colonies WHERE id=?",(m.group(1),)).fetchone()
                return self._json(dict(r) if r else None)
            self._err(404,"Not found")
        finally: con.close()

    def api_post(self, path):
        if path=="/api/restore" and re.match(r"application/(x-)?zip",self.headers.get("Content-Type") or "",re.I):
            return self.api_restore_zip()
        if path=="/api/settings":
            body2=self._rjson()
            con2=db()
            for k,v in body2.items():
                con2.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)",(k,str(v)))
            con2.commit(); con2.close()
            return self._json({"ok":True})
        m=re.match(r"^/api/([a-z_]+)$",path)
        if m and m.group(1) in SCHEMA:
            return self._post_zeile(m.group(1), self._rjson())
        if path=="/api/logo":
            if self._upload_zu_gross(UPLOAD_MAX_BYTES): return
            data=self._rraw()
            if not data: return self._err(400,"Leerer Upload")
            with open(LOGO_PATH,"wb") as f: f.write(data)
            return self._json({"ok":True})
        if path=="/api/photos":
            if self._upload_zu_gross(UPLOAD_MAX_BYTES): return
            data=self._rraw()
            if not data: return self._err(400,"Leerer Upload")
            pid=new_id()
            with open(os.path.join(PHOTO_DIR,pid+".jpg"),"wb") as f: f.write(data)
            return self._json({"id":pid})

        con=db()
        try:
            # archive / restore
            m=re.match(r"^/api/colonies/([^/]+)/(archive|restore)$",path)
            if m:
                cid,action=m.group(1),m.group(2)
                if not ID_RE.match(cid): return self._err(400,"Bad id")
                if action=="archive":
                    row=con.execute("SELECT name FROM colonies WHERE id=?",(cid,)).fetchone()
                    name=(row["name"] if row else "") or ""
                    if name and not name.startswith("Archiv-"):
                        name="Archiv-"+name
                    con.execute("UPDATE colonies SET archived=1,archivedAt=?,name=? WHERE id=?",(now_iso(),name,cid))
                else:
                    target=(self._rjson() or {}).get("apiaryId")
                    if target:
                        con.execute("UPDATE colonies SET archived=0,archivedAt=NULL,apiaryId=? WHERE id=?",(target,cid))
                    else:
                        con.execute("UPDATE colonies SET archived=0,archivedAt=NULL WHERE id=?",(cid,))
                con.commit(); return self._json({"ok":True})

            # move colony to different apiary
            m=re.match(r"^/api/colonies/([^/]+)/move$",path)
            if m:
                cid=m.group(1)
                if not ID_RE.match(cid): return self._err(400,"Bad id")
                body=self._rjson()
                target=body.get("apiaryId","")
                if not target: return self._err(400,"apiaryId fehlt")
                con.execute("UPDATE colonies SET apiaryId=? WHERE id=?",(target,cid))
                con.commit(); return self._json({"ok":True})

            body=self._rjson()

            if path=="/api/colonies/bulk-update":
                ids=body.get("ids",[]); fields=body.get("fields",{})
                allowed={"queenYear","queenNr","queenGen","status","source","scaleId","notes","umlarvDate","zielGewicht"}
                sets={k:v for k,v in fields.items() if k in allowed}
                if sets and ids:
                    sql="UPDATE colonies SET "+", ".join(f"{k}=?" for k in sets)+\
                        " WHERE id IN ("+",".join("?"*len(ids))+")"
                    con.execute(sql, list(sets.values())+ids)
                    con.commit()
                return self._json({"ok":True})

            if path in ("/api/entries/clear-fuetterung","/api/colonies/clear-honigraeume",
                        "/api/colonies/clear-demaree","/api/colonies/clear-oxalblock",
                        "/api/colonies/clear-umlarv") and not has_recent_backup(con):
                return self._err(403,f"Diese Aktion benötigt ein Backup, das höchstens {BACKUP_GRACE_DAYS} Tage alt ist. Bitte zuerst ein Backup erstellen.")

            if path=="/api/entries/clear-fuetterung":
                rows_=con.execute("SELECT id,obs_extra,photos,photoIds FROM entries").fetchall()
                deleted=0; ids=[]
                for r in rows_:
                    try: extra=json.loads(r["obs_extra"] or "{}")
                    except: extra={}
                    if extra.get("fuetterType"):
                        ids+=photo_ids(entry_photos(r))
                        con.execute("DELETE FROM entries WHERE id=?",(r["id"],))
                        deleted+=1
                delete_photos(con, ids)
                con.commit()
                return self._json({"ok":True,"deleted":deleted})

            if path=="/api/colonies/clear-honigraeume":
                con.execute("UPDATE colonies SET honigRaeume='[]'")
                con.commit()
                return self._json({"ok":True})

            if path=="/api/colonies/clear-demaree":
                con.execute("UPDATE colonies SET demareeStage='',demareedAt='',demareeEndedAt=''")
                con.commit()
                return self._json({"ok":True})

            if path=="/api/colonies/clear-oxalblock":
                con.execute("UPDATE colonies SET oxalBlockStage='',oxalBlockStartAt='',oxalBlockLastAt=''")
                con.commit()
                return self._json({"ok":True})

            if path=="/api/colonies/clear-umlarv":
                con.execute("UPDATE colonies SET umlarvDate=''")
                con.commit()
                return self._json({"ok":True})

            if path=="/api/colonies/reorder":
                for i,cid in enumerate(body.get("order",[])):
                    if ID_RE.match(str(cid)):
                        con.execute("UPDATE colonies SET sortOrder=? WHERE id=?",(i,cid))
                con.commit(); return self._json({"ok":True})

            if path=="/api/restore": return self.api_restore(con, body)
            self._err(404,"Not found")
        finally: con.close()

    def _post_zeile(self, tabelle, body):
        """Neuanlage fuer jede Tabelle aus SCHEMA, Sonderfaelle je Tabelle hier."""
        con=db()
        try:
            werte=werte_aus_body(tabelle, body, "post")
            rid=new_id(); werte["id"]=rid
            jetzt=now_iso()
            if tabelle in POST_CREATED_JETZT: werte["createdAt"]=jetzt
            if tabelle=="colonies":
                werte["archived"]=0; werte["archivedAt"]=None
                # Zielgewicht: falls nicht mitgeschickt, aus allgemeiner Einstellung
                if not body.get("zielGewicht",""):
                    row=con.execute("SELECT value FROM settings WHERE key='zielGewicht'").fetchone()
                    werte["zielGewicht"]=row["value"] if row else "40"
            elif tabelle=="trachten":
                werte["name"]=body.get("name","").strip()
            elif tabelle=="honey_stir_batches":
                werte["status"]="active"; werte["conclusion"]=""
            elif tabelle=="honey_products":
                werte["sortOrder"]=int(con.execute(
                    "SELECT COALESCE(MAX(sortOrder),-1)+1 FROM honey_products").fetchone()[0])
            elif tabelle in ("honey_sales","honey_costs"):
                werte["updatedAt"]=jetzt
            elif tabelle=="sirup_calc":
                werte["createdAt"]=body.get("createdAt","") or jetzt
            zeile_einfuegen(con, tabelle, werte)
            if tabelle=="sirup_calc":
                con.execute("DELETE FROM sirup_calc WHERE id NOT IN (SELECT id FROM sirup_calc ORDER BY createdAt DESC LIMIT 20)")
            con.commit(); return self._json({"id":rid})
        finally: con.close()

    def api_put(self, path):
        con=db()
        try:
            body=self._rjson()
            m=re.match(r"^/api/([a-z_]+)/([^/]+)$",path)
            if not m or m.group(1) not in SCHEMA or m.group(1) in PUT_GESPERRT:
                return self._err(404,"Not found")
            tabelle,rid=m.group(1),m.group(2)
            if not ID_RE.match(rid): return self._err(400,"Bad id")
            # colonies: nur mitgeschickte Felder (PUT_TEILWEISE). Die App schickt seit
            # v2.9.58 nur geaenderte Felder (putColony in app.js) - so ueberschreibt ein
            # laenger offener Tab / zweites Geraet keine Felder, die es gar nicht
            # geaendert hat. Dasselbe Feld auf zwei Geraeten: der Letzte gewinnt.
            werte=werte_aus_body(tabelle, body, "put")
            alte_fotos=[]
            if tabelle=="entries":
                old=con.execute("SELECT photos,photoIds FROM entries WHERE id=?",(rid,)).fetchone()
                alte_fotos=photo_ids(entry_photos(old)) if old else []
            elif tabelle=="honey_stir_entries":
                old=con.execute("SELECT photos FROM honey_stir_entries WHERE id=?",(rid,)).fetchone()
                alte_fotos=photo_ids(json.loads(old["photos"] or "[]")) if old else []
            elif tabelle=="trachten":
                werte["name"]=body.get("name","").strip()
            elif tabelle in ("honey_sales","honey_costs"):
                werte["updatedAt"]=now_iso()
            zeile_aendern(con, tabelle, rid, werte)
            if alte_fotos:
                neue=photo_ids(body.get("photos",[]))
                delete_photos(con,[p for p in alte_fotos if p not in neue])
            con.commit(); self._json({"ok":True})
        finally: con.close()

    def api_delete(self, path):
        if path=="/api/logo":
            try: os.remove(LOGO_PATH)
            except FileNotFoundError: pass
            return self._json({"ok":True})
        con=db()
        try:
            m=re.match(r"^/api/(apiaries|colonies|entries|scales|trachten|reminders|honey_harvests|sirup_calc|honey_stir_batches|honey_stir_entries|honey_products|honey_sales|honey_costs)/([^/]+)$",path)
            if not m: return self._err(404,"Not found")
            kind,rid=m.group(1),m.group(2)
            if not ID_RE.match(rid): return self._err(400,"Bad id")
            if kind=="apiaries":
                for c in con.execute("SELECT id FROM colonies WHERE apiaryId=? AND archived=0",(rid,)).fetchall():
                    delete_colony_cascade(con,c["id"])
                con.execute("DELETE FROM apiaries WHERE id=?",(rid,))
            elif kind=="colonies": delete_colony_cascade(con,rid)
            elif kind=="entries":
                e=con.execute("SELECT photos,photoIds FROM entries WHERE id=?",(rid,)).fetchone()
                con.execute("DELETE FROM entries WHERE id=?",(rid,))
                if e: delete_photos(con,photo_ids(entry_photos(e)))
            elif kind=="reminders":
                con.execute("DELETE FROM reminders WHERE id=?",(rid,))
            elif kind=="honey_harvests":
                con.execute("DELETE FROM honey_harvests WHERE id=?",(rid,))
            elif kind=="sirup_calc":
                con.execute("DELETE FROM sirup_calc WHERE id=?",(rid,))
            elif kind=="scales":
                con.execute("UPDATE colonies SET scaleId='' WHERE scaleId=?",(rid,))
                con.execute("DELETE FROM scales WHERE id=?",(rid,))
            elif kind=="trachten":
                con.execute("DELETE FROM trachten WHERE id=?",(rid,))
            elif kind=="honey_stir_batches":
                ids=[]
                for e in con.execute("SELECT photos FROM honey_stir_entries WHERE batchId=?",(rid,)).fetchall():
                    ids+=photo_ids(json.loads(e["photos"] or "[]"))
                con.execute("DELETE FROM honey_stir_entries WHERE batchId=?",(rid,))
                con.execute("DELETE FROM honey_stir_batches WHERE id=?",(rid,))
                delete_photos(con,ids)
            elif kind=="honey_stir_entries":
                e=con.execute("SELECT photos FROM honey_stir_entries WHERE id=?",(rid,)).fetchone()
                con.execute("DELETE FROM honey_stir_entries WHERE id=?",(rid,))
                if e: delete_photos(con,photo_ids(json.loads(e["photos"] or "[]")))
            elif kind=="honey_products":
                con.execute("DELETE FROM honey_products WHERE id=?",(rid,))
            elif kind=="honey_sales":
                con.execute("DELETE FROM honey_sales WHERE id=?",(rid,))
            elif kind=="honey_costs":
                con.execute("DELETE FROM honey_costs WHERE id=?",(rid,))
            con.commit(); self._json({"ok":True})
        finally: con.close()

    def api_backup(self, con, fmt=""):
        """Export als JSON (nur Daten) oder mit format=zip als ZIP: backup.json +
        photos/<id>.jpg. Das ZIP wird in eine Temp-Datei unter DATA_DIR gebaut
        (nicht /tmp - das ist oft eine RAM-Disk) und in Bloecken ausgeliefert."""
        con.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('_lastBackupAt',?)",(now_iso(),))
        con.commit()
        out=self._backup_daten(con)
        if fmt=="zip":
            datum=datetime.now().strftime("%Y-%m-%d")
            with tempfile.TemporaryFile(dir=DATA_DIR) as tmp:
                with zipfile.ZipFile(tmp,"w") as zf:
                    zf.writestr("backup.json", json.dumps(out), compress_type=zipfile.ZIP_DEFLATED)
                    if os.path.isdir(PHOTO_DIR):
                        for name in sorted(os.listdir(PHOTO_DIR)):
                            if BACKUP_FOTO_RE.match("photos/"+name):
                                # JPEGs sind schon komprimiert - nur ablegen spart CPU auf dem Pi
                                zf.write(os.path.join(PHOTO_DIR,name),"photos/"+name,compress_type=zipfile.ZIP_STORED)
                tmp.seek(0,2); groesse=tmp.tell(); tmp.seek(0)
                self.send_response(200)
                self.send_header("Content-Type","application/zip")
                self.send_header("Content-Disposition",f'attachment; filename="beetown-backup-{datum}.zip"')
                self.send_header("Content-Length",str(groesse))
                self.end_headers()
                shutil.copyfileobj(tmp,self.wfile,1<<20)
            return
        body=json.dumps(out).encode()
        self.send_response(200)
        self.send_header("Content-Type","application/json; charset=utf-8")
        self.send_header("Content-Disposition",'attachment; filename="beetown-backup.json"')
        self.send_header("Content-Length",str(len(body)))
        self.end_headers(); self.wfile.write(body)

    def api_restore_zip(self):
        """Import eines ZIP-Backups (backup.json + photos/). Upload wird in
        Bloecken in eine Temp-Datei geschrieben statt komplett in den RAM."""
        n=int(self.headers.get("Content-Length",0))
        if n<=0: return self._err(400,"Leerer Upload")
        if n>RESTORE_MAX_BYTES: return self._err(413,"Backup-Datei zu groß")
        with tempfile.TemporaryFile(dir=DATA_DIR) as tmp:
            rest=n
            while rest>0:
                chunk=self.rfile.read(min(rest,1<<20))
                if not chunk: return self._err(400,"Upload abgebrochen")
                tmp.write(chunk); rest-=len(chunk)
            tmp.seek(0)
            try: zf=zipfile.ZipFile(tmp)
            except zipfile.BadZipFile: return self._err(400,"Keine gültige Backup-Datei (ZIP defekt)")
            with zf:
                try: data=json.loads(zf.read("backup.json").decode())
                except KeyError: return self._err(400,"Keine gültige Backup-Datei (backup.json fehlt)")
                if not isinstance(data,dict) or data.get("app")!="imkerei":
                    return self._err(400,"Keine gültige Backup-Datei")
                # Fotos zuerst: zusaetzliche Dateien schaden nicht, falls danach
                # der Datenbank-Teil scheitert (der wird dann komplett zurueckgerollt).
                os.makedirs(PHOTO_DIR,exist_ok=True)
                for info in zf.infolist():
                    if info.is_dir() or not BACKUP_FOTO_RE.match(info.filename): continue
                    ziel=os.path.join(PHOTO_DIR,info.filename.split("/",1)[1])
                    with zf.open(info) as src, open(ziel+".restore-tmp","wb") as dst:
                        shutil.copyfileobj(src,dst,1<<20)
                    os.replace(ziel+".restore-tmp",ziel)
        con=db()
        try: return self.api_restore(con,data)
        finally: con.close()

    def _backup_daten(self, con):
        return {"app":"imkerei","version":9,
             "apiaries":rows(con,"SELECT * FROM apiaries"),
             "colonies":rows(con,"SELECT * FROM colonies"),
             "entries":[parse_entry(r) for r in con.execute("SELECT * FROM entries").fetchall()],
             "scales":rows(con,"SELECT * FROM scales"),
             "trachten":rows(con,"SELECT * FROM trachten"),
             "honey_harvests":rows(con,"SELECT * FROM honey_harvests"),
             "reminders":[parse_reminder(r) for r in con.execute("SELECT * FROM reminders").fetchall()],
             "sirup_calc":rows(con,"SELECT * FROM sirup_calc"),
             "honey_stir_batches":rows(con,"SELECT * FROM honey_stir_batches"),
             "honey_stir_entries":[parse_stir_entry(r) for r in con.execute("SELECT * FROM honey_stir_entries").fetchall()],
             "honey_products":[parse_product(r) for r in con.execute("SELECT * FROM honey_products").fetchall()],
             "honey_sales":[parse_sale(r) for r in con.execute("SELECT * FROM honey_sales").fetchall()],
             "honey_costs":rows(con,"SELECT * FROM honey_costs"),
             "settings":rows(con,"SELECT * FROM settings")}

    def api_restore(self, con, body):
        if body.get("app")!="imkerei": return self._err(400,"Keine gültige Backup-Datei")
        for t in list(SCHEMA)+["settings"]: con.execute(f"DELETE FROM {t}")
        for tabelle in SCHEMA:
            for zeile in body.get(tabelle,[]):
                werte=werte_aus_body(tabelle, zeile, "restore")
                werte["id"]=zeile["id"]
                if tabelle=="entries" and not zeile.get("photos"):
                    # sehr alte Backups: nur photoIds statt photos
                    werte["photos"]=json.dumps([{"id":p,"caption":""} for p in zeile.get("photoIds",[])])
                elif tabelle in ("honey_sales","honey_costs"):
                    werte["updatedAt"]=zeile.get("updatedAt") or zeile.get("createdAt","")
                zeile_einfuegen(con, tabelle, werte)
        for s in body.get("settings",[]):
            con.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)",
                (s.get("key",""),s.get("value","")))
        con.commit(); self._json({"ok":True})

    def log_message(self, fmt, *args): pass


def main():
    init_db()
    httpd = ThreadingHTTPServer((HOST,PORT),Handler)
    print(f"BeeTown-Server läuft auf http://{HOST}:{PORT}  (Daten: {DATA_DIR})")
    try: httpd.serve_forever()
    except KeyboardInterrupt: httpd.shutdown()

if __name__=="__main__": main()
