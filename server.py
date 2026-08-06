#!/usr/bin/env python3
"""
BeeTown – kleiner Server (nur Python-Standardbibliothek).
"""

import os, re, json, sqlite3, secrets, mimetypes
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
# Wird von setup/install.sh angelegt - sowohl auf einem Raspberry Pi als
# auch auf einem generischen Linux-Server (beide bekommen das Setup-Portal
# seit der Linux-Server-Unterstuetzung gleichermassen). Dient als
# Erkennungsmerkmal fuer /api/platform, ob es ueberhaupt eine Setup-Seite
# gibt, auf die verwiesen werden kann (Backup/Update) - NICHT ob es
# speziell ein Raspberry Pi ist, dafuer siehe _is_raspberry_pi().
PI_MARKER_DIR = "/opt/imkerei-wifi-setup"


def _is_raspberry_pi():
    """Echte Hardware-Erkennung (wie in imkerei_wifi_portal.py) - im
    Unterschied zu PI_MARKER_DIR (der nur "Setup-Portal installiert"
    bedeutet, auch auf einem Linux-Server). Fuer Pi-spezifische Dinge wie
    die USB-Backup-Warnung (SD-Karten-Ausfallrisiko betrifft nur den Pi)."""
    try:
        with open("/proc/device-tree/model") as f:
            return "raspberry pi" in f.read().lower()
    except Exception:
        return False
# Wird vom taeglichen Update-Check-Timer (imkerei-wifi-setup) geschrieben -
# hier nur best-effort mitgelesen, um im Frontend einen kleinen Hinweis
# anzuzeigen, ohne selbst GitHub kontaktieren zu muessen.
UPDATE_CHECK_STATE_PATH = os.path.join(PI_MARKER_DIR, "update_check.json")
# Gleicher Pfad wie BACKUP_DIR im Setup-Portal (imkerei_wifi_portal.py) - der
# taegliche Backup-Timer legt dort Archive ab, ohne ueber /api/backup zu
# laufen. Wird hier nur mitgelesen, um "gibt es ein aktuelles Backup?" auch
# fuer die naechtlichen Pi-Backups zu erkennen (nicht nur JSON-Exports).
BACKUP_DIR = "/opt/backup"
BACKUP_NAME_RE = re.compile(r"^imkerei-backup-[0-9-]+\.tar\.gz$")
BACKUP_GRACE_DAYS = 3
USB_MOUNT = "/mnt/backup-usb"
# install.sh legt diese Datei nur an, wenn Port 80 beim Einrichten schon
# belegt war und das Setup-Portal stattdessen auf einem Ausweich-Port laeuft
# (siehe imkerei-wifi-setup.service). Wird hier mitgelesen, damit das
# Frontend Links zur Setup-/Backup-Seite mit dem richtigen Port bauen kann -
# ohne Port 80 fest anzunehmen, laeuft dort sonst ins Leere.
LANDING_PORT_ENV_PATH = "/etc/default/imkerei-wifi-setup"


def landing_port():
    try:
        with open(LANDING_PORT_ENV_PATH) as f:
            content = f.read()
        m = re.search(r"^IMKEREI_LANDING_PORT=(\d+)", content, re.MULTILINE)
        if m:
            return int(m.group(1))
    except Exception:
        pass
    return 80

os.makedirs(PHOTO_DIR, exist_ok=True)
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
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
def db():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con
def column_exists(con, table, col):
    return any(r[1]==col for r in con.execute(f"PRAGMA table_info({table})").fetchall())

def init_db():
    con = db()
    con.executescript("""
        CREATE TABLE IF NOT EXISTS apiaries(
            id TEXT PRIMARY KEY, name TEXT, location TEXT, notes TEXT, createdAt TEXT);
        CREATE TABLE IF NOT EXISTS colonies(
            id TEXT PRIMARY KEY, apiaryId TEXT, name TEXT, queenYear TEXT,
            queenNr TEXT, queenGen TEXT, status TEXT, source TEXT, notes TEXT,
            scaleId TEXT, sortOrder INTEGER DEFAULT 0, createdAt TEXT,
            archived INTEGER DEFAULT 0, archivedAt TEXT,
            demareeStage TEXT, demareedAt TEXT, demareeEndedAt TEXT,
            requeueFlag INTEGER DEFAULT 0, requeueReasons TEXT, requeueNote TEXT,
            breedFlag INTEGER DEFAULT 0, honigRaeume TEXT, umlarvDate TEXT, weiselprobeDate TEXT, kaefigungDate TEXT, koeniginFreiDate TEXT,
            currentWeight TEXT, currentWeightDate TEXT, zielGewicht TEXT,
            oxalBlockStage TEXT, oxalBlockStartAt TEXT, oxalBlockLastAt TEXT);
        CREATE TABLE IF NOT EXISTS entries(
            id TEXT PRIMARY KEY, colonyId TEXT, date TEXT, type TEXT,
            notes TEXT, photoIds TEXT, obs TEXT, photos TEXT,
            obs_extra TEXT, temper TEXT, strength TEXT, food TEXT, demareeAction TEXT, entryHrNr TEXT, oxalBlockAction TEXT,
            varroaCount TEXT, varroaAnts INTEGER DEFAULT 0, createdAt TEXT);
        CREATE TABLE IF NOT EXISTS scales(
            id TEXT PRIMARY KEY, name TEXT, url TEXT, notes TEXT, createdAt TEXT);
        CREATE TABLE IF NOT EXISTS settings(
            key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE IF NOT EXISTS reminders(
            id TEXT PRIMARY KEY, text TEXT, apiaryId TEXT, apiaryName TEXT, createdAt TEXT,
            dueDate TEXT, remindDaysBefore INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS honey_harvests(
            id TEXT PRIMARY KEY, year INTEGER, tracht TEXT, menge REAL, notizen TEXT, apiaryId TEXT, apiaryName TEXT, anzahlVoelker INTEGER DEFAULT 0, createdAt TEXT);
        CREATE TABLE IF NOT EXISTS sirup_calc(
            id TEXT PRIMARY KEY, date TEXT, ratio TEXT, mode TEXT,
            inputValue TEXT, sugar TEXT, water TEXT, result TEXT, createdAt TEXT);
        CREATE TABLE IF NOT EXISTS honey_stir_batches(
            id TEXT PRIMARY KEY, honeyType TEXT, amountKg TEXT,
            seedDate TEXT, seedTemp TEXT, seedAmountG TEXT, seedHoneyType TEXT,
            status TEXT DEFAULT 'active', conclusion TEXT, createdAt TEXT);
        CREATE TABLE IF NOT EXISTS honey_stir_entries(
            id TEXT PRIMARY KEY, batchId TEXT, date TEXT, temp TEXT,
            appearance TEXT, photos TEXT, createdAt TEXT);
        CREATE TABLE IF NOT EXISTS honey_products(
            id TEXT PRIMARY KEY, name TEXT, price REAL DEFAULT 0, sizeGrams INTEGER DEFAULT 0,
            active INTEGER DEFAULT 1, sortOrder INTEGER DEFAULT 0, color TEXT DEFAULT '', createdAt TEXT);
        CREATE TABLE IF NOT EXISTS honey_sales(
            id TEXT PRIMARY KEY, date TEXT, category TEXT, buyerName TEXT, items TEXT,
            total REAL DEFAULT 0, notes TEXT, createdAt TEXT);
        CREATE TABLE IF NOT EXISTS honey_costs(
            id TEXT PRIMARY KEY, date TEXT, description TEXT, supplier TEXT, amount REAL DEFAULT 0,
            notes TEXT, createdAt TEXT);
        CREATE INDEX IF NOT EXISTS idx_col_apiary ON colonies(apiaryId);
        CREATE INDEX IF NOT EXISTS idx_ent_colony ON entries(colonyId);
        CREATE INDEX IF NOT EXISTS idx_stirentry_batch ON honey_stir_entries(batchId);
    """)
    migrations = [
        ("colonies","archived",      "ALTER TABLE colonies ADD COLUMN archived INTEGER DEFAULT 0"),
        ("colonies","archivedAt",    "ALTER TABLE colonies ADD COLUMN archivedAt TEXT"),
        ("colonies","queenYear",     "ALTER TABLE colonies ADD COLUMN queenYear TEXT"),
        ("colonies","source",        "ALTER TABLE colonies ADD COLUMN source TEXT"),
        ("colonies","notes",         "ALTER TABLE colonies ADD COLUMN notes TEXT"),
        ("colonies","queenNr",       "ALTER TABLE colonies ADD COLUMN queenNr TEXT"),
        ("colonies","queenGen",      "ALTER TABLE colonies ADD COLUMN queenGen TEXT"),
        ("colonies","scaleId",       "ALTER TABLE colonies ADD COLUMN scaleId TEXT"),
        ("colonies","sortOrder",     "ALTER TABLE colonies ADD COLUMN sortOrder INTEGER DEFAULT 0"),
        ("colonies","demareeStage",  "ALTER TABLE colonies ADD COLUMN demareeStage TEXT"),
        ("colonies","demareedAt",    "ALTER TABLE colonies ADD COLUMN demareedAt TEXT"),
        ("colonies","demareeEndedAt","ALTER TABLE colonies ADD COLUMN demareeEndedAt TEXT"),
        ("colonies","requeueFlag",   "ALTER TABLE colonies ADD COLUMN requeueFlag INTEGER DEFAULT 0"),
        ("colonies","requeueReasons","ALTER TABLE colonies ADD COLUMN requeueReasons TEXT"),
        ("colonies","requeueNote",   "ALTER TABLE colonies ADD COLUMN requeueNote TEXT"),
        ("colonies","breedFlag",     "ALTER TABLE colonies ADD COLUMN breedFlag INTEGER DEFAULT 0"),
        ("entries","obs",        "ALTER TABLE entries ADD COLUMN obs TEXT"),
        ("entries","photos",     "ALTER TABLE entries ADD COLUMN photos TEXT"),
        ("entries","obs_extra",  "ALTER TABLE entries ADD COLUMN obs_extra TEXT"),
        ("entries","temper",     "ALTER TABLE entries ADD COLUMN temper TEXT"),
        ("entries","strength",   "ALTER TABLE entries ADD COLUMN strength TEXT"),
        ("entries","food",       "ALTER TABLE entries ADD COLUMN food TEXT"),
        ("entries","demareeAction","ALTER TABLE entries ADD COLUMN demareeAction TEXT"),
        ("entries","entryHrNr",    "ALTER TABLE entries ADD COLUMN entryHrNr TEXT"),
        ("colonies","honigRaeume",   "ALTER TABLE colonies ADD COLUMN honigRaeume TEXT"),
        ("colonies","umlarvDate",    "ALTER TABLE colonies ADD COLUMN umlarvDate TEXT"),
        ("reminders","apiaryId",    "ALTER TABLE reminders ADD COLUMN apiaryId TEXT"),
        ("reminders","apiaryName",  "ALTER TABLE reminders ADD COLUMN apiaryName TEXT"),
        ("colonies","weiselprobeDate","ALTER TABLE colonies ADD COLUMN weiselprobeDate TEXT"),
        ("colonies","kaefigungDate",    "ALTER TABLE colonies ADD COLUMN kaefigungDate TEXT"),
        ("colonies","koeniginFreiDate", "ALTER TABLE colonies ADD COLUMN koeniginFreiDate TEXT"),
        ("honey_harvests","apiaryId",   "ALTER TABLE honey_harvests ADD COLUMN apiaryId TEXT"),
        ("honey_harvests","apiaryName", "ALTER TABLE honey_harvests ADD COLUMN apiaryName TEXT"),
        ("honey_harvests","anzahlVoelker", "ALTER TABLE honey_harvests ADD COLUMN anzahlVoelker INTEGER DEFAULT 0"),
        ("colonies","currentWeight",     "ALTER TABLE colonies ADD COLUMN currentWeight TEXT"),
        ("colonies","currentWeightDate", "ALTER TABLE colonies ADD COLUMN currentWeightDate TEXT"),
        ("colonies","zielGewicht",       "ALTER TABLE colonies ADD COLUMN zielGewicht TEXT"),
        ("colonies","oxalBlockStage",    "ALTER TABLE colonies ADD COLUMN oxalBlockStage TEXT"),
        ("colonies","oxalBlockStartAt",  "ALTER TABLE colonies ADD COLUMN oxalBlockStartAt TEXT"),
        ("colonies","oxalBlockLastAt",   "ALTER TABLE colonies ADD COLUMN oxalBlockLastAt TEXT"),
        ("entries","oxalBlockAction",    "ALTER TABLE entries ADD COLUMN oxalBlockAction TEXT"),
        ("entries","varroaCount",        "ALTER TABLE entries ADD COLUMN varroaCount TEXT"),
        ("entries","varroaAnts",         "ALTER TABLE entries ADD COLUMN varroaAnts INTEGER DEFAULT 0"),
        ("reminders","dueDate",          "ALTER TABLE reminders ADD COLUMN dueDate TEXT"),
        ("reminders","remindDaysBefore", "ALTER TABLE reminders ADD COLUMN remindDaysBefore INTEGER DEFAULT 0"),
        ("honey_products","color",       "ALTER TABLE honey_products ADD COLUMN color TEXT DEFAULT ''"),
    ]
    for table, col, sql in migrations:
        if not column_exists(con, table, col):
            con.execute(sql)
    if con.execute("SELECT COUNT(*) FROM honey_products").fetchone()[0] == 0:
        for i, (name, price, grams, color) in enumerate(DEFAULT_HONEY_PRODUCTS):
            con.execute("INSERT INTO honey_products(id,name,price,sizeGrams,active,sortOrder,color,createdAt) VALUES(?,?,?,?,1,?,?,?)",
                (new_id(), name, price, grams, i, color, now_iso()))
    # Farben auch fuer bereits vorhandene Standard-Produkte nachtragen (z.B. nach Upgrade
    # von einer Version ohne Farb-Spalte), aber keine vom Nutzer bewusst geloeschte Farbe ueberschreiben.
    for prefix, color in HONEY_PRODUCT_COLOR_BY_PREFIX:
        con.execute("UPDATE honey_products SET color=? WHERE (color IS NULL OR color='') AND name LIKE ?",
            (color, prefix+'%'))
    for name, order in HONEY_PRODUCT_SORTORDER_BY_NAME.items():
        con.execute("UPDATE honey_products SET sortOrder=? WHERE name=?", (order, name))
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

def delete_photos(ids):
    for pid in (ids or []):
        if ID_RE.match(str(pid)):
            try: os.remove(os.path.join(PHOTO_DIR, pid+".jpg"))
            except FileNotFoundError: pass

def delete_colony_cascade(con, cid):
    for e in con.execute("SELECT photos,photoIds FROM entries WHERE colonyId=?",(cid,)).fetchall():
        delete_photos(photo_ids(entry_photos(e)))
    con.execute("DELETE FROM entries WHERE colonyId=?",(cid,))
    con.execute("DELETE FROM colonies WHERE id=?",(cid,))


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

    def _rjson(self):
        n=int(self.headers.get("Content-Length",0))
        return json.loads(self.rfile.read(n).decode()) if n>0 else {}

    def _rraw(self):
        n=int(self.headers.get("Content-Length",0))
        return self.rfile.read(n) if n>0 else b""

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
        if p.startswith("/api/"): return self.api_get(p)
        self.serve_static(p)

    def do_POST(self):
        if self.path.startswith("/api/"): return self.api_post(self.path)
        self._err(404,"Not found")

    def do_PUT(self):
        if self.path.startswith("/api/"): return self.api_put(self.path)
        self._err(404,"Not found")

    def do_DELETE(self):
        if self.path.startswith("/api/"): return self.api_delete(self.path)
        self._err(404,"Not found")

    def serve_static(self, path):
        if path in ("/",""): path="/index.html"
        rel=path.lstrip("/")
        full=os.path.normpath(os.path.join(STATIC_DIR,rel))
        if not full.startswith(STATIC_DIR) or not os.path.isfile(full):
            return self._err(404,"Not found")
        ct=mimetypes.guess_type(full)[0] or "application/octet-stream"
        with open(full,"rb") as f: self._bytes(f.read(),ct)

    def api_get(self, path):
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
                rs=con.execute("""
                    SELECT e.*, c.name AS colonyName, c.apiaryId AS apiaryId, a.name AS apiaryName
                    FROM (
                        SELECT *, ROW_NUMBER() OVER (
                            PARTITION BY colonyId ORDER BY date DESC, createdAt DESC
                        ) AS rn
                        FROM entries
                    ) e
                    JOIN colonies c ON c.id = e.colonyId
                    LEFT JOIN apiaries a ON a.id = c.apiaryId
                    WHERE e.rn = 1 AND c.archived = 0
                    ORDER BY e.date DESC, e.createdAt DESC
                """).fetchall()
                return self._json([parse_entry(r) for r in rs])
            if path=="/api/scales":
                return self._json(rows(con,"SELECT * FROM scales ORDER BY name"))
            if path=="/api/settings":
                r=con.execute("SELECT key,value FROM settings").fetchall()
                return self._json({row[0]:row[1] for row in r})
            if path=="/api/reminders":
                return self._json(rows(con,"SELECT * FROM reminders ORDER BY createdAt DESC"))
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
                return self._json(rows(con,"SELECT * FROM honey_products ORDER BY sortOrder,name"))
            if path=="/api/honey_sales":
                rs=con.execute("SELECT * FROM honey_sales ORDER BY date DESC, createdAt DESC").fetchall()
                return self._json([parse_sale(r) for r in rs])
            if path=="/api/honey_costs":
                return self._json(rows(con,"SELECT * FROM honey_costs ORDER BY date DESC, createdAt DESC"))
            if path=="/api/backup": return self.api_backup(con)
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
        if path=="/api/settings":
            body2=self._rjson()
            con2=db()
            for k,v in body2.items():
                con2.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)",(k,str(v)))
            con2.commit(); con2.close()
            return self._json({"ok":True})
        if path=="/api/reminders":
            body2=self._rjson()
            rid=new_id()
            con2=db()
            con2.execute("INSERT INTO reminders(id,text,apiaryId,apiaryName,createdAt,dueDate,remindDaysBefore) VALUES(?,?,?,?,?,?,?)",(rid,body2.get("text",""),body2.get("apiaryId",""),body2.get("apiaryName",""),body2.get("createdAt",""),body2.get("dueDate",""),int(body2.get("remindDaysBefore",0) or 0)))
            con2.commit(); con2.close()
            return self._json({"id":rid})
        if path=="/api/honey_harvests":
            body2=self._rjson()
            rid=new_id()
            con2=db()
            con2.execute("INSERT INTO honey_harvests(id,year,tracht,menge,notizen,apiaryId,apiaryName,anzahlVoelker,createdAt) VALUES(?,?,?,?,?,?,?,?,?)",
                (rid,int(body2.get("year",0)),body2.get("tracht",""),float(body2.get("menge",0)),
                 body2.get("notizen",""),body2.get("apiaryId",""),body2.get("apiaryName",""),int(body2.get("anzahlVoelker",0) or 0),now_iso()))
            con2.commit(); con2.close()
            return self._json({"id":rid})
        if path=="/api/honey_stir_batches":
            body2=self._rjson()
            rid=new_id()
            con2=db()
            con2.execute("""INSERT INTO honey_stir_batches
                (id,honeyType,amountKg,seedDate,seedTemp,seedAmountG,seedHoneyType,status,conclusion,createdAt)
                VALUES(?,?,?,?,?,?,?,?,?,?)""",
                (rid,body2.get("honeyType",""),body2.get("amountKg",""),body2.get("seedDate",""),
                 body2.get("seedTemp",""),body2.get("seedAmountG",""),body2.get("seedHoneyType",""),
                 "active","",now_iso()))
            con2.commit(); con2.close()
            return self._json({"id":rid})
        if path=="/api/honey_stir_entries":
            body2=self._rjson()
            rid=new_id()
            con2=db()
            con2.execute("""INSERT INTO honey_stir_entries
                (id,batchId,date,temp,appearance,photos,createdAt) VALUES(?,?,?,?,?,?,?)""",
                (rid,body2.get("batchId",""),body2.get("date",""),body2.get("temp",""),
                 body2.get("appearance",""),json.dumps(body2.get("photos",[])),now_iso()))
            con2.commit(); con2.close()
            return self._json({"id":rid})
        if path=="/api/honey_products":
            body2=self._rjson()
            rid=new_id()
            con2=db()
            maxSort=con2.execute("SELECT COALESCE(MAX(sortOrder),-1)+1 FROM honey_products").fetchone()[0]
            con2.execute("INSERT INTO honey_products(id,name,price,sizeGrams,active,sortOrder,color,createdAt) VALUES(?,?,?,?,?,?,?,?)",
                (rid,body2.get("name",""),float(body2.get("price",0) or 0),int(body2.get("sizeGrams",0) or 0),
                 1 if body2.get("active",True) else 0,int(maxSort),body2.get("color",""),now_iso()))
            con2.commit(); con2.close()
            return self._json({"id":rid})
        if path=="/api/honey_sales":
            body2=self._rjson()
            rid=new_id()
            con2=db()
            con2.execute("INSERT INTO honey_sales(id,date,category,buyerName,items,total,notes,createdAt) VALUES(?,?,?,?,?,?,?,?)",
                (rid,body2.get("date",""),body2.get("category",""),body2.get("buyerName",""),
                 json.dumps(body2.get("items",[])),float(body2.get("total",0) or 0),body2.get("notes",""),now_iso()))
            con2.commit(); con2.close()
            return self._json({"id":rid})
        if path=="/api/honey_costs":
            body2=self._rjson()
            rid=new_id()
            con2=db()
            con2.execute("INSERT INTO honey_costs(id,date,description,supplier,amount,notes,createdAt) VALUES(?,?,?,?,?,?,?)",
                (rid,body2.get("date",""),body2.get("description",""),body2.get("supplier",""),
                 float(body2.get("amount",0) or 0),body2.get("notes",""),now_iso()))
            con2.commit(); con2.close()
            return self._json({"id":rid})
        if path=="/api/sirup_calc":
            body2=self._rjson()
            rid=new_id()
            con2=db()
            con2.execute("INSERT INTO sirup_calc(id,date,ratio,mode,inputValue,sugar,water,result,createdAt) VALUES(?,?,?,?,?,?,?,?,?)",
                (rid,body2.get("date",""),body2.get("ratio",""),body2.get("mode",""),
                 body2.get("inputValue",""),body2.get("sugar",""),body2.get("water",""),body2.get("result",""),
                 body2.get("createdAt","") or now_iso()))
            con2.execute("DELETE FROM sirup_calc WHERE id NOT IN (SELECT id FROM sirup_calc ORDER BY createdAt DESC LIMIT 20)")
            con2.commit(); con2.close()
            return self._json({"id":rid})
        if path=="/api/logo":
            data=self._rraw()
            if not data: return self._err(400,"Leerer Upload")
            with open(LOGO_PATH,"wb") as f: f.write(data)
            return self._json({"ok":True})
        if path=="/api/photos":
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

            if path=="/api/apiaries":
                rid=new_id()
                con.execute("INSERT INTO apiaries(id,name,location,notes,createdAt) VALUES(?,?,?,?,?)",
                    (rid,body.get("name",""),body.get("location",""),body.get("notes",""),body.get("createdAt","")))
                con.commit(); return self._json({"id":rid})

            if path=="/api/colonies":
                rid=new_id()
                # Zielgewicht: falls nicht mitgeschickt, aus allgemeiner Einstellung übernehmen
                zg = body.get("zielGewicht","")
                if not zg:
                    row = con.execute("SELECT value FROM settings WHERE key='zielGewicht'").fetchone()
                    zg = row["value"] if row else ""
                con.execute("""INSERT INTO colonies
                    (id,apiaryId,name,queenYear,queenNr,queenGen,status,source,notes,scaleId,
                     sortOrder,createdAt,archived,demareeStage,demareedAt,demareeEndedAt,
                     requeueFlag,requeueReasons,requeueNote,breedFlag,honigRaeume,umlarvDate,weiselprobeDate,kaefigungDate,koeniginFreiDate,
                     currentWeight,currentWeightDate,zielGewicht,oxalBlockStage,oxalBlockStartAt,oxalBlockLastAt)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (rid,body.get("apiaryId",""),body.get("name",""),body.get("queenYear",""),
                     body.get("queenNr",""),body.get("queenGen",""),body.get("status","ok"),
                     body.get("source",""),body.get("notes",""),body.get("scaleId",""),
                     body.get("sortOrder",0),body.get("createdAt",""),
                     body.get("demareeStage",""),body.get("demareedAt",""),body.get("demareeEndedAt",""),
                     int(body.get("requeueFlag",0) or 0),body.get("requeueReasons","[]"),
                     body.get("requeueNote",""),int(body.get("breedFlag",0) or 0),
                     body.get("honigRaeume","[]"),body.get("umlarvDate",""),
                     body.get("weiselprobeDate",""),body.get("kaefigungDate",""),body.get("koeniginFreiDate",""),
                     body.get("currentWeight",""),body.get("currentWeightDate",""),zg,
                     body.get("oxalBlockStage",""),body.get("oxalBlockStartAt",""),body.get("oxalBlockLastAt","")))
                con.commit(); return self._json({"id":rid})

            if path=="/api/entries":
                rid=new_id()
                con.execute("""INSERT INTO entries
                    (id,colonyId,date,type,notes,photos,obs,obs_extra,temper,strength,food,demareeAction,entryHrNr,oxalBlockAction,varroaCount,varroaAnts,createdAt)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (rid,body.get("colonyId",""),body.get("date",""),body.get("type",""),
                     body.get("notes",""),json.dumps(body.get("photos",[])),
                     json.dumps(body.get("obs",[])),json.dumps(body.get("obs_extra",{})),
                     body.get("temper",""),body.get("strength",""),body.get("food",""),
                     body.get("demareeAction",""),body.get("entryHrNr",""),body.get("oxalBlockAction",""),
                     body.get("varroaCount",""),int(body.get("varroaAnts",0) or 0),body.get("createdAt","")))
                con.commit(); return self._json({"id":rid})

            if path=="/api/scales":
                rid=new_id()
                con.execute("INSERT INTO scales(id,name,url,notes,createdAt) VALUES(?,?,?,?,?)",
                    (rid,body.get("name",""),body.get("url",""),body.get("notes",""),now_iso()))
                con.commit(); return self._json({"id":rid})

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
                deleted=0
                for r in rows_:
                    try: extra=json.loads(r["obs_extra"] or "{}")
                    except: extra={}
                    if extra.get("fuetterType"):
                        delete_photos(photo_ids(entry_photos(r)))
                        con.execute("DELETE FROM entries WHERE id=?",(r["id"],))
                        deleted+=1
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

    def api_put(self, path):
        con=db()
        try:
            body=self._rjson()
            m=re.match(r"^/api/(apiaries|colonies|entries|scales|reminders|honey_harvests|honey_stir_batches|honey_stir_entries|honey_products|honey_sales|honey_costs)/([^/]+)$",path)
            if not m: return self._err(404,"Not found")
            kind,rid=m.group(1),m.group(2)
            if not ID_RE.match(rid): return self._err(400,"Bad id")
            if kind=="apiaries":
                con.execute("UPDATE apiaries SET name=?,location=?,notes=? WHERE id=?",
                    (body.get("name",""),body.get("location",""),body.get("notes",""),rid))
            elif kind=="colonies":
                con.execute("""UPDATE colonies SET
                    apiaryId=?,name=?,queenYear=?,queenNr=?,queenGen=?,status=?,source=?,notes=?,scaleId=?,
                    demareeStage=?,demareedAt=?,demareeEndedAt=?,
                    requeueFlag=?,requeueReasons=?,requeueNote=?,breedFlag=?,honigRaeume=?,umlarvDate=?,weiselprobeDate=?,kaefigungDate=?,koeniginFreiDate=?,
                    currentWeight=?,currentWeightDate=?,zielGewicht=?,oxalBlockStage=?,oxalBlockStartAt=?,oxalBlockLastAt=?
                    WHERE id=?""",
                    (body.get("apiaryId",""),body.get("name",""),body.get("queenYear",""),body.get("queenNr",""),
                     body.get("queenGen",""),body.get("status","ok"),body.get("source",""),
                     body.get("notes",""),body.get("scaleId",""),
                     body.get("demareeStage",""),body.get("demareedAt",""),body.get("demareeEndedAt",""),
                     int(body.get("requeueFlag",0) or 0),body.get("requeueReasons","[]"),
                     body.get("requeueNote",""),int(body.get("breedFlag",0) or 0),
                     body.get("honigRaeume","[]"),body.get("umlarvDate",""),
                     body.get("weiselprobeDate",""),body.get("kaefigungDate",""),body.get("koeniginFreiDate",""),
                     body.get("currentWeight",""),body.get("currentWeightDate",""),body.get("zielGewicht",""),
                     body.get("oxalBlockStage",""),body.get("oxalBlockStartAt",""),body.get("oxalBlockLastAt",""),rid))
            elif kind=="entries":
                old=con.execute("SELECT photos,photoIds FROM entries WHERE id=?",(rid,)).fetchone()
                old_ids=photo_ids(entry_photos(old)) if old else []
                new_photos=body.get("photos",[])
                delete_photos([p for p in old_ids if p not in photo_ids(new_photos)])
                con.execute("""UPDATE entries SET
                    date=?,type=?,notes=?,photos=?,obs=?,obs_extra=?,temper=?,strength=?,food=?,demareeAction=?,entryHrNr=?,oxalBlockAction=?,varroaCount=?,varroaAnts=?
                    WHERE id=?""",
                    (body.get("date",""),body.get("type",""),body.get("notes",""),
                     json.dumps(new_photos),json.dumps(body.get("obs",[])),
                     json.dumps(body.get("obs_extra",{})),
                     body.get("temper",""),body.get("strength",""),body.get("food",""),
                     body.get("demareeAction",""),body.get("entryHrNr",""),body.get("oxalBlockAction",""),
                     body.get("varroaCount",""),int(body.get("varroaAnts",0) or 0),rid))
            elif kind=="reminders":
                con.execute("UPDATE reminders SET text=?,apiaryId=?,apiaryName=?,dueDate=?,remindDaysBefore=? WHERE id=?",
                    (body.get("text",""),body.get("apiaryId",""),body.get("apiaryName",""),
                     body.get("dueDate",""),int(body.get("remindDaysBefore",0) or 0),rid))
            elif kind=="scales":
                con.execute("UPDATE scales SET name=?,url=?,notes=? WHERE id=?",
                    (body.get("name",""),body.get("url",""),body.get("notes",""),rid))
            elif kind=="honey_harvests":
                con.execute("UPDATE honey_harvests SET year=?,tracht=?,menge=?,notizen=?,apiaryId=?,apiaryName=?,anzahlVoelker=? WHERE id=?",
                    (int(body.get("year",0)),body.get("tracht",""),float(body.get("menge",0)),
                     body.get("notizen",""),body.get("apiaryId",""),body.get("apiaryName",""),int(body.get("anzahlVoelker",0) or 0),rid))
            elif kind=="honey_stir_batches":
                con.execute("""UPDATE honey_stir_batches SET
                    honeyType=?,amountKg=?,seedDate=?,seedTemp=?,seedAmountG=?,seedHoneyType=?,status=?,conclusion=?
                    WHERE id=?""",
                    (body.get("honeyType",""),body.get("amountKg",""),body.get("seedDate",""),
                     body.get("seedTemp",""),body.get("seedAmountG",""),body.get("seedHoneyType",""),
                     body.get("status","active"),body.get("conclusion",""),rid))
            elif kind=="honey_stir_entries":
                old=con.execute("SELECT photos FROM honey_stir_entries WHERE id=?",(rid,)).fetchone()
                old_ids=photo_ids(json.loads(old["photos"] or "[]")) if old else []
                new_photos=body.get("photos",[])
                delete_photos([p for p in old_ids if p not in photo_ids(new_photos)])
                con.execute("UPDATE honey_stir_entries SET date=?,temp=?,appearance=?,photos=? WHERE id=?",
                    (body.get("date",""),body.get("temp",""),body.get("appearance",""),
                     json.dumps(new_photos),rid))
            elif kind=="honey_products":
                con.execute("UPDATE honey_products SET name=?,price=?,sizeGrams=?,active=?,sortOrder=?,color=? WHERE id=?",
                    (body.get("name",""),float(body.get("price",0) or 0),int(body.get("sizeGrams",0) or 0),
                     1 if body.get("active",True) else 0,int(body.get("sortOrder",0) or 0),body.get("color",""),rid))
            elif kind=="honey_sales":
                con.execute("UPDATE honey_sales SET date=?,category=?,buyerName=?,items=?,total=?,notes=? WHERE id=?",
                    (body.get("date",""),body.get("category",""),body.get("buyerName",""),
                     json.dumps(body.get("items",[])),float(body.get("total",0) or 0),body.get("notes",""),rid))
            elif kind=="honey_costs":
                con.execute("UPDATE honey_costs SET date=?,description=?,supplier=?,amount=?,notes=? WHERE id=?",
                    (body.get("date",""),body.get("description",""),body.get("supplier",""),
                     float(body.get("amount",0) or 0),body.get("notes",""),rid))
            con.commit(); self._json({"ok":True})
        finally: con.close()

    def api_delete(self, path):
        if path=="/api/logo":
            try: os.remove(LOGO_PATH)
            except FileNotFoundError: pass
            return self._json({"ok":True})
        con=db()
        try:
            m=re.match(r"^/api/(apiaries|colonies|entries|scales|reminders|honey_harvests|sirup_calc|honey_stir_batches|honey_stir_entries|honey_products|honey_sales|honey_costs)/([^/]+)$",path)
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
                if e: delete_photos(photo_ids(entry_photos(e)))
                con.execute("DELETE FROM entries WHERE id=?",(rid,))
            elif kind=="reminders":
                con.execute("DELETE FROM reminders WHERE id=?",(rid,))
            elif kind=="honey_harvests":
                con.execute("DELETE FROM honey_harvests WHERE id=?",(rid,))
            elif kind=="sirup_calc":
                con.execute("DELETE FROM sirup_calc WHERE id=?",(rid,))
            elif kind=="scales":
                con.execute("UPDATE colonies SET scaleId='' WHERE scaleId=?",(rid,))
                con.execute("DELETE FROM scales WHERE id=?",(rid,))
            elif kind=="honey_stir_batches":
                for e in con.execute("SELECT photos FROM honey_stir_entries WHERE batchId=?",(rid,)).fetchall():
                    delete_photos(photo_ids(json.loads(e["photos"] or "[]")))
                con.execute("DELETE FROM honey_stir_entries WHERE batchId=?",(rid,))
                con.execute("DELETE FROM honey_stir_batches WHERE id=?",(rid,))
            elif kind=="honey_stir_entries":
                e=con.execute("SELECT photos FROM honey_stir_entries WHERE id=?",(rid,)).fetchone()
                if e: delete_photos(photo_ids(json.loads(e["photos"] or "[]")))
                con.execute("DELETE FROM honey_stir_entries WHERE id=?",(rid,))
            elif kind=="honey_products":
                con.execute("DELETE FROM honey_products WHERE id=?",(rid,))
            elif kind=="honey_sales":
                con.execute("DELETE FROM honey_sales WHERE id=?",(rid,))
            elif kind=="honey_costs":
                con.execute("DELETE FROM honey_costs WHERE id=?",(rid,))
            con.commit(); self._json({"ok":True})
        finally: con.close()

    def api_backup(self, con):
        con.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('_lastBackupAt',?)",(now_iso(),))
        con.commit()
        out={"app":"imkerei","version":9,
             "apiaries":rows(con,"SELECT * FROM apiaries"),
             "colonies":rows(con,"SELECT * FROM colonies"),
             "entries":[parse_entry(r) for r in con.execute("SELECT * FROM entries").fetchall()],
             "scales":rows(con,"SELECT * FROM scales"),
             "honey_harvests":rows(con,"SELECT * FROM honey_harvests"),
             "reminders":rows(con,"SELECT * FROM reminders"),
             "sirup_calc":rows(con,"SELECT * FROM sirup_calc"),
             "honey_stir_batches":rows(con,"SELECT * FROM honey_stir_batches"),
             "honey_stir_entries":[parse_stir_entry(r) for r in con.execute("SELECT * FROM honey_stir_entries").fetchall()],
             "honey_products":rows(con,"SELECT * FROM honey_products"),
             "honey_sales":[parse_sale(r) for r in con.execute("SELECT * FROM honey_sales").fetchall()],
             "honey_costs":rows(con,"SELECT * FROM honey_costs"),
             "settings":rows(con,"SELECT * FROM settings")}
        body=json.dumps(out).encode()
        self.send_response(200)
        self.send_header("Content-Type","application/json; charset=utf-8")
        self.send_header("Content-Disposition",'attachment; filename="beetown-backup.json"')
        self.send_header("Content-Length",str(len(body)))
        self.end_headers(); self.wfile.write(body)

    def api_restore(self, con, body):
        if body.get("app")!="imkerei": return self._err(400,"Keine gültige Backup-Datei")
        for t in ("apiaries","colonies","entries","scales","honey_harvests","reminders","sirup_calc",
                  "honey_stir_batches","honey_stir_entries","honey_products","honey_sales","honey_costs",
                  "settings"): con.execute(f"DELETE FROM {t}")
        for a in body.get("apiaries",[]):
            con.execute("INSERT INTO apiaries(id,name,location,notes,createdAt) VALUES(?,?,?,?,?)",
                (a["id"],a.get("name",""),a.get("location",""),a.get("notes",""),a.get("createdAt","")))
        for c in body.get("colonies",[]):
            con.execute("""INSERT INTO colonies
                (id,apiaryId,name,queenYear,queenNr,queenGen,status,source,notes,scaleId,
                 sortOrder,createdAt,archived,archivedAt,demareeStage,demareedAt,demareeEndedAt,
                 requeueFlag,requeueReasons,requeueNote,breedFlag,honigRaeume,umlarvDate,
                 weiselprobeDate,kaefigungDate,koeniginFreiDate,currentWeight,currentWeightDate,zielGewicht,
                 oxalBlockStage,oxalBlockStartAt,oxalBlockLastAt)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (c["id"],c.get("apiaryId",""),c.get("name",""),c.get("queenYear",""),
                 c.get("queenNr",""),c.get("queenGen",""),c.get("status","ok"),
                 c.get("source",""),c.get("notes",""),c.get("scaleId",""),
                 c.get("sortOrder",0),c.get("createdAt",""),
                 int(c.get("archived",0) or 0),c.get("archivedAt"),
                 c.get("demareeStage",""),c.get("demareedAt",""),c.get("demareeEndedAt",""),
                 int(c.get("requeueFlag",0) or 0),c.get("requeueReasons","[]"),
                 c.get("requeueNote",""),int(c.get("breedFlag",0) or 0),
                 c.get("honigRaeume","[]"),c.get("umlarvDate",""),
                 c.get("weiselprobeDate",""),c.get("kaefigungDate",""),c.get("koeniginFreiDate",""),
                 c.get("currentWeight",""),c.get("currentWeightDate",""),c.get("zielGewicht",""),
                 c.get("oxalBlockStage",""),c.get("oxalBlockStartAt",""),c.get("oxalBlockLastAt","")))
        for e in body.get("entries",[]):
            photos=e.get("photos") or [{"id":p,"caption":""} for p in e.get("photoIds",[])]
            con.execute("""INSERT INTO entries
                (id,colonyId,date,type,notes,photos,obs,obs_extra,temper,strength,food,demareeAction,entryHrNr,oxalBlockAction,varroaCount,varroaAnts,createdAt)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (e["id"],e.get("colonyId",""),e.get("date",""),e.get("type",""),
                 e.get("notes",""),json.dumps(photos),json.dumps(e.get("obs",[])),
                 json.dumps(e.get("obs_extra",{})),
                 e.get("temper",""),e.get("strength",""),e.get("food",""),
                 e.get("demareeAction",""),e.get("entryHrNr",""),e.get("oxalBlockAction",""),
                 e.get("varroaCount",""),int(e.get("varroaAnts",0) or 0),e.get("createdAt","")))
        for s in body.get("scales",[]):
            con.execute("INSERT INTO scales(id,name,url,notes,createdAt) VALUES(?,?,?,?,?)",
                (s["id"],s.get("name",""),s.get("url",""),s.get("notes",""),s.get("createdAt","")))
        for h in body.get("honey_harvests",[]):
            con.execute("""INSERT INTO honey_harvests
                (id,year,tracht,menge,notizen,apiaryId,apiaryName,anzahlVoelker,createdAt)
                VALUES(?,?,?,?,?,?,?,?,?)""",
                (h["id"],int(h.get("year",0) or 0),h.get("tracht",""),float(h.get("menge",0) or 0),
                 h.get("notizen",""),h.get("apiaryId",""),h.get("apiaryName",""),
                 int(h.get("anzahlVoelker",0) or 0),h.get("createdAt","")))
        for r in body.get("reminders",[]):
            con.execute("INSERT INTO reminders(id,text,apiaryId,apiaryName,createdAt,dueDate,remindDaysBefore) VALUES(?,?,?,?,?,?,?)",
                (r["id"],r.get("text",""),r.get("apiaryId",""),r.get("apiaryName",""),r.get("createdAt",""),
                 r.get("dueDate",""),int(r.get("remindDaysBefore",0) or 0)))
        for sc in body.get("sirup_calc",[]):
            con.execute("INSERT INTO sirup_calc(id,date,ratio,mode,inputValue,sugar,water,result,createdAt) VALUES(?,?,?,?,?,?,?,?,?)",
                (sc["id"],sc.get("date",""),sc.get("ratio",""),sc.get("mode",""),
                 sc.get("inputValue",""),sc.get("sugar",""),sc.get("water",""),sc.get("result",""),sc.get("createdAt","")))
        for b in body.get("honey_stir_batches",[]):
            con.execute("""INSERT INTO honey_stir_batches
                (id,honeyType,amountKg,seedDate,seedTemp,seedAmountG,seedHoneyType,status,conclusion,createdAt)
                VALUES(?,?,?,?,?,?,?,?,?,?)""",
                (b["id"],b.get("honeyType",""),b.get("amountKg",""),b.get("seedDate",""),
                 b.get("seedTemp",""),b.get("seedAmountG",""),b.get("seedHoneyType",""),
                 b.get("status","active"),b.get("conclusion",""),b.get("createdAt","")))
        for e in body.get("honey_stir_entries",[]):
            con.execute("""INSERT INTO honey_stir_entries
                (id,batchId,date,temp,appearance,photos,createdAt) VALUES(?,?,?,?,?,?,?)""",
                (e["id"],e.get("batchId",""),e.get("date",""),e.get("temp",""),
                 e.get("appearance",""),json.dumps(e.get("photos",[])),e.get("createdAt","")))
        for p in body.get("honey_products",[]):
            con.execute("""INSERT INTO honey_products
                (id,name,price,sizeGrams,active,sortOrder,color,createdAt) VALUES(?,?,?,?,?,?,?,?)""",
                (p["id"],p.get("name",""),float(p.get("price",0) or 0),int(p.get("sizeGrams",0) or 0),
                 1 if p.get("active",True) else 0,int(p.get("sortOrder",0) or 0),p.get("color",""),p.get("createdAt","")))
        for sa in body.get("honey_sales",[]):
            con.execute("""INSERT INTO honey_sales
                (id,date,category,buyerName,items,total,notes,createdAt) VALUES(?,?,?,?,?,?,?,?)""",
                (sa["id"],sa.get("date",""),sa.get("category",""),sa.get("buyerName",""),
                 json.dumps(sa.get("items",[])),float(sa.get("total",0) or 0),sa.get("notes",""),sa.get("createdAt","")))
        for co in body.get("honey_costs",[]):
            con.execute("""INSERT INTO honey_costs
                (id,date,description,supplier,amount,notes,createdAt) VALUES(?,?,?,?,?,?,?)""",
                (co["id"],co.get("date",""),co.get("description",""),co.get("supplier",""),
                 float(co.get("amount",0) or 0),co.get("notes",""),co.get("createdAt","")))
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
