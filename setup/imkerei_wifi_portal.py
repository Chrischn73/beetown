#!/usr/bin/env python3
"""
Dauerhaft laufender Webserver mit zwei Seiten fuer den BeeTown-Pi:

- Setup-/Startseite auf Port 80 (http://<hostname>.local): Links zu BeeTown
  und WLAN-Einstellungen, aktuelle IP-Adressen, Neustart/Herunterfahren.
- WLAN-Einstellungen auf Port 8081 (http://<hostname>.local:8081): WLAN
  einrichten/wechseln/trennen, mit Zurueck-Link zur Setup-Seite.

BeeTown selbst laeuft unveraendert auf Port 8080. Beide Seiten laufen
permanent (nicht nur beim Ersteinrichten) im selben Prozess, unabhaengig
davon, ob gerade WLAN verbunden ist oder nicht - Kabel oder WLAN, beides
geht. Nur Python-Standardbibliothek.

Verhalten:
- GET  /                    (Port 80)   -> Startseite mit Links, IPs, System-Buttons
- GET  /tipps               (Port 80)   -> Handy-Tipps ("Zum Home-Bildschirm")
- GET  /backup              (Port 80)   -> Backup-Liste (SD-Karte + ggf.
  USB-Stick) zum Herunterladen, erstellen, Zeitplan + Aufbewahrungsanzahl,
  USB-Stick formatieren/aushaengen
- GET  /backup/restore      (Port 80)   -> eigene Seite: Datenbank + Fotos
  per Dropdown-Auswahl ODER direkt von einer PC-Datei wiederherstellen
  (App-Code bleibt unangetastet)
- GET  /backup/downloads    (Port 80)   -> eigene Seite: Backup per Dropdown
  auswaehlen und herunterladen
- GET  /backup/download/<local|usb>/<f> (Port 80) -> laedt ein Backup-Archiv
  herunter
- GET  /backup/usb/format-status (Port 80) -> JSON-Status waehrend des
  (asynchronen) Formatierens, per Polling von einem kleinen Overlay auf der
  Backup-Seite abgefragt (kein Seitenwechsel, per fetch() im Hintergrund)
- GET  /update               (Port 80) -> zeigt installierte und neueste
  Version (GitHub-Release), mit Update-Button falls eine neuere verfuegbar
  ist. Legt vor jedem Update automatisch ein Backup an
- GET  /update/status        (Port 80) -> JSON-Status waehrend des
  (asynchronen) Aktualisierens, per Polling von einem Overlay abgefragt
- GET  /logo.png            (beide Ports) -> App-Icon aus /opt/imkerei/static
- POST /backup/create, /backup/restore, /backup/restore-upload,
  /backup/settings, /backup/usb/format, /backup/usb/mount,
  /backup/usb/eject, /update/run (Port 80)
- GET  /                    (Port 8081) -> WLAN-Formular (Status, Verbinden, Trennen)
- POST /connect             (Port 8081) -> verbindet per nmcli mit dem gewaehlten
  WLAN. Faellt bei Fehlschlag automatisch auf die vorher aktive Verbindung
  zurueck, damit der Pi nicht unerreichbar wird. Nach Erfolg automatische
  Weiterleitung zur Setup-Seite (Port 80).
- POST /disconnect          (Port 8081) -> trennt die aktuelle WLAN-Verbindung
  (autoconnect wird dabei deaktiviert)
- GET  /status              (Port 8081) -> JSON-Status des laufenden
  Verbindungsversuchs (Polling von der "Verbinde..."-Seite)
- POST /system/reboot, /system/shutdown (Port 80) -> Neustart/Shutdown
"""

import io
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote

# Wird von do_POST() waehrend des Verbindungsversuchs aktualisiert und von
# GET /status abgefragt (Polling von der "Verbinde..."-Seite aus). Einfache
# dict-Zuweisungen sind dank GIL fuer diesen Zweck ausreichend thread-sicher.
CONN_STATE = {"done": False, "ok": None, "detail": None}

# Wird waehrend des (langwierigen) Formatierens eines USB-Sticks aktualisiert
# und von GET /backup/usb/format-status abgefragt (Polling von der
# "Formatiere..."-Seite aus).
FORMAT_STATE = {"done": True, "ok": None, "detail": None}

# Wird waehrend des (langwierigen) App-Updates aktualisiert und von
# GET /update/status abgefragt (Polling von einem Overlay auf der
# Update-Seite aus).
UPDATE_STATE = {"done": True, "ok": None, "detail": None}

HOST = "0.0.0.0"
PORT_LANDING = 80
PORT_WIFI = 8081
APP_PORT = 8080

BACKUP_DIR = "/opt/backup"
BACKUP_SCRIPT = "/opt/backup-scripts/imkerei-backup.sh"
BACKUP_DATA_PREFIX = "imkerei/data"
BACKUP_NAME_RE = re.compile(r"^imkerei-backup-[0-9-]+\.tar\.gz$")
BACKUP_TIMER_PATH = "/etc/systemd/system/imkerei-backup.timer"
BACKUP_CONFIG_PATH = "/opt/backup-scripts/backup.conf"
BACKUP_SCHEDULES = {
    "daily": "*-*-* 03:30:00",
    "weekly": "Mon *-*-* 03:30:00",
}
DEFAULT_MAX_BACKUPS = 20

USB_MOUNT = "/mnt/backup-usb"

# Oeffentliches GitHub-Repo als Update-Quelle. Ein GitHub-Release-Tag "vX.Y.Z"
# muss mit APP_VERSION in static/app.js uebereinstimmen, damit der
# Versionsvergleich funktioniert. Der von GitHub automatisch erzeugte
# Source-Tarball eines Release enthaelt server.py und static/ 1:1 wie im
# Repo - keine separaten Release-Assets noetig.
GITHUB_REPO = "Chrischn73/beetown"
GITHUB_LATEST_RELEASE_URL = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"
UPDATE_CHECK_STATE_PATH = "/opt/imkerei-wifi-setup/update_check.json"

STYLE = """
  :root {{
    --bg: #fff; --fg: #222; --muted: #666; --box-bg: #f5f5f5;
    --msg-ok-bg: #dfd; --msg-err-bg: #fdd;
    --input-bg: #fff; --input-border: #ccc;
    --btn-bg: #f0a500; --btn-fg: #1a1a1a; --btn-active: #d99400;
    --danger-bg: #e0483e; --danger-fg: #fff; --danger-active: #b53a32;
  }}
  @media (prefers-color-scheme: dark) {{
    :root {{
      --bg: #121212; --fg: #e8e8e8; --muted: #999; --box-bg: #262626;
      --msg-ok-bg: #17301d; --msg-err-bg: #3a1c1c;
      --input-bg: #1e1e1e; --input-border: #444;
      --btn-bg: #f0a500; --btn-fg: #1a1a1a; --btn-active: #d99400;
      --danger-bg: #c0392b; --danger-fg: #fff; --danger-active: #962d22;
    }}
  }}
  body {{ font-family: sans-serif; max-width: 420px; margin: 2rem auto; padding: 0 1rem;
          background: var(--bg); color: var(--fg); }}
  h1 {{ font-size: 1.3rem; }}
  p {{ line-height: 1.5; }}
  label {{ display: block; margin-top: 1rem; font-weight: bold; }}
  select, input {{ width: 100%; padding: .6rem; font-size: 1rem; box-sizing: border-box; margin-top: .25rem;
            background: var(--input-bg); color: var(--fg); border: 1px solid var(--input-border); }}
  button, .btn {{ display: block; width: 100%; padding: .8rem; font-size: 1rem; margin-top: 1.5rem;
            background: var(--btn-bg); border: none; border-radius: 8px; box-sizing: border-box;
            text-align: center; text-decoration: none; color: var(--btn-fg); font-weight: bold; }}
  button:active, .btn:active {{ background: var(--btn-active); }}
  .btn-danger {{ background: var(--danger-bg); color: var(--danger-fg); }}
  .btn-danger:active {{ background: var(--danger-active); }}
  .msg {{ padding: .8rem; border-radius: 6px; margin-bottom: 1rem; background: var(--box-bg); }}
  .err {{ background: var(--msg-err-bg); }}
  .ok  {{ background: var(--msg-ok-bg); }}
  .spinner {{ display: inline-block; width: 1.1em; height: 1.1em; border: 3px solid var(--btn-bg);
              border-top-color: transparent; border-radius: 50%; vertical-align: -0.2em;
              margin-right: .4em; animation: spin 0.8s linear infinite; }}
  @keyframes spin {{ to {{ transform: rotate(360deg); }} }}
  .header {{ display: flex; align-items: center; gap: .6rem; margin-bottom: 1rem; }}
  .header img {{ width: 40px; height: 40px; border-radius: 8px; }}
  .header .name {{ font-weight: bold; font-size: 1.1rem; }}
  .header .version {{ font-size: .8rem; color: var(--muted); }}
  .btn-row {{ display: flex; gap: .5rem; margin-top: 1.5rem; }}
  .btn-row form {{ flex: 1; margin: 0; }}
  .btn-small {{ margin-top: 0; padding: .5rem; font-size: .85rem; }}
  .muted {{ color: var(--muted); }}
  .modal-backdrop {{ display: none; position: fixed; inset: 0; background: rgba(0,0,0,.5);
                      align-items: center; justify-content: center; z-index: 1000; }}
  .modal-backdrop.show {{ display: flex; }}
  .modal-box {{ background: var(--bg); color: var(--fg); border-radius: 12px; padding: 1.5rem;
                max-width: 320px; width: 85%; text-align: center; }}
  .modal-box h1 {{ font-size: 1.1rem; }}
"""

SYSTEM_BUTTONS = """
<div class="btn-row">
<form method="post" action="/system/reboot" onsubmit="return confirm('Pi wirklich neu starten?');">
  <button type="submit" class="btn-danger btn-small">🔄 Neu starten</button>
</form>
<form method="post" action="/system/shutdown" onsubmit="return confirm('Pi wirklich herunterfahren? Danach muss der Strom manuell getrennt und wieder verbunden werden, um ihn erneut zu starten.');">
  <button type="submit" class="btn-danger btn-small">⏻ Herunterfahren</button>
</form>
</div>
"""

PAGE_HEADER = """
<div class="header">
  <img src="/logo.png" alt="BeeTown">
  <div>
    <div class="name">BeeTown</div>
    <div class="version">{app_version}</div>
  </div>
</div>
"""

PAGE_LANDING = """<!doctype html>
<html lang="de"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BeeTown-Pi</title>
<style>""" + STYLE + """</style>
</head><body>
{header}
<h1>🐝 BeeTown-Pi</h1>
{status}
{update_banner}
<a class="btn" href="{app_url}" target="_blank" rel="noopener">🐝 BeeTown öffnen</a>
<a class="btn" href="{wifi_url}">📶 WLAN-Einstellungen</a>
<a class="btn" href="/backup">📦 Backups</a>
<a class="btn" href="/update">🔄 Update</a>
<a class="btn" href="/tipps" style="padding:.5rem; font-size:.85rem;">📱 Handy-Tipps</a>
<div class="msg" style="font-size:.9rem;">
<strong>IP-Adressen:</strong><br>
Kabel (eth0): {eth0_ip}<br>
WLAN (wlan0): {wlan0_ip}
</div>""" + SYSTEM_BUTTONS + """
</body></html>
"""

TIPS_CONTENT = """
<p class="muted" style="text-align:center; font-size:.9rem;">Für ein eigenes
App-Symbol ohne Adressleiste – „Zum Home-Bildschirm hinzufügen“:</p>
<div class="msg ok" style="text-align:center; margin-top:1.5rem;">
🤖 <strong>Android (Chrome)</strong><br>
Menü ⋮ oben rechts öffnen → „Zum Startbildschirm hinzufügen“ antippen
</div>
<div class="msg ok" style="text-align:center; margin-top:1.5rem;">
🍎 <strong>iPhone (Safari)</strong><br>
Teilen-Symbol ⬆️ unten antippen → „Zum Home-Bildschirm“ auswählen
</div>
"""

PAGE_TIPPS = """<!doctype html>
<html lang="de"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Handy-Tipps</title>
<style>""" + STYLE + """</style>
</head><body>
{header}
<h1>📱 Handy-Tipps</h1>""" + TIPS_CONTENT + """
<a class="btn" href="/">← Zurück zur Übersicht</a>
</body></html>
"""

PAGE_FORM = """<!doctype html>
<html lang="de"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BeeTown – WLAN-Einstellungen</title>
<style>""" + STYLE + """</style>
</head><body>
{header}
<h1>🐝 WLAN-Einstellungen</h1>
{status}
<a class="btn" href="{app_url}" target="_blank" rel="noopener">🐝 BeeTown öffnen</a>
{message}
<form method="post" action="/connect">
  <label for="ssid">WLAN-Name (SSID)</label>
  {ssid_field}
  <label for="password">WLAN-Passwort</label>
  <input type="password" id="password" name="password" autocomplete="off">
  <button type="submit">Verbinden</button>
</form>
{disconnect_form}
<a class="btn" href="{landing_url}">← Zurück zur Übersicht</a>
</body></html>
"""

DISCONNECT_FORM = """
<form method="post" action="/disconnect" onsubmit="return confirmDisconnect()">
  <button type="submit" class="btn-danger">🔌 WLAN trennen</button>
</form>
<script>
function confirmDisconnect() {{
  if (!confirm('WLAN wirklich trennen? BeeTown ist danach eventuell nicht ' +
               'mehr erreichbar, falls kein Netzwerkkabel angeschlossen ist.')) {{
    return false;
  }}
  return confirm('Ganz sicher? Diese WLAN-Einstellungen-Seite bleibt zwar ' +
                  'erreichbar, aber BeeTown kann offline gehen, bis ein ' +
                  'neues WLAN eingerichtet ist.');
}}
</script>
"""

PAGE_CONNECTING = """<!doctype html>
<html lang="de"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Verbinde…</title>
<style>""" + STYLE + """</style>
</head><body>
<div id="status">
  <h1><span class="spinner"></span>Verbinde mit „{ssid}“…</h1>
  <p>Der Pi verbindet sich jetzt mit dem WLAN. Falls gerade eine andere
  WLAN-Verbindung aktiv war, bleibt sie bestehen, falls die neue nicht
  klappt.</p>
</div>
<p>Sobald die Verbindung steht, ist BeeTown hier erreichbar:</p>
<a class="btn" href="{app_url}" target="_blank" rel="noopener">🐝 BeeTown öffnen</a>
<p class="muted" style="margin-top:2rem; font-size:.9rem;">
Falls sich die Seite nicht öffnen lässt: kurz warten, das Handy neu mit dem
richtigen WLAN verbinden und den Link erneut versuchen.</p>
<script>
(function poll() {{
  fetch('/status').then(r => r.json()).then(data => {{
    if (!data.done) {{ setTimeout(poll, 1500); return; }}
    var el = document.getElementById('status');
    if (data.ok) {{
      el.innerHTML = '<div class="msg ok">✅ Verbindung erfolgreich hergestellt! ' +
        'Weiter zur Setup-Seite …</div>';
      setTimeout(function() {{
        window.location.href = 'http://' + location.hostname + '/';
      }}, 2500);
    }} else {{
      el.innerHTML = '<div class="msg err">❌ Verbindung fehlgeschlagen'
        + (data.detail ? ': ' + data.detail : '') + '</div>'
        + '<a class="btn" href="/">Zurück zu den WLAN-Einstellungen</a>';
    }}
  }}).catch(() => setTimeout(poll, 1500));
}})();
</script>
</body></html>
"""

PAGE_BACKUP = """<!doctype html>
<html lang="de"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Backups</title>
<style>""" + STYLE + """</style>
</head><body>
{header}
<h1>📦 Backups</h1>
<p>Sichert den kompletten Ordner <code>/opt/imkerei</code> (App-Code,
Datenbank und Fotos) – immer auf der SD-Karte, zusätzlich auf einem
eingerichteten USB-Stick, falls vorhanden.</p>
{message}
<form method="post" action="/backup/create">
  <button type="submit">📦 Jetzt Backup erstellen</button>
</form>
<a class="btn" href="/backup/restore">♻ Backup wiederherstellen</a>
<a class="btn" href="/backup/downloads">⬇ Backup herunterladen</a>

<h2 style="font-size:1.05rem; margin-top:2rem;">Einstellungen</h2>
<form method="post" action="/backup/settings">
  <label for="schedule">Automatisches Backup</label>
  <select id="schedule" name="schedule">
    <option value="daily" {daily_selected}>Täglich (nachts 03:30 Uhr)</option>
    <option value="weekly" {weekly_selected}>Wöchentlich (Montag 03:30 Uhr)</option>
  </select>
  <label for="max_backups">Max. Anzahl Backups (je Ort)</label>
  <input type="number" id="max_backups" name="max_backups" min="1" max="100" value="{max_backups}">
  <button type="submit">Einstellungen speichern</button>
</form>

<h2 style="font-size:1.05rem; margin-top:2rem;">USB-Stick</h2>
{usb_section}

<a class="btn" href="/">← Zurück zur Übersicht</a>

<div id="format-modal" class="modal-backdrop">
  <div class="modal-box" id="format-modal-content"></div>
</div>
<script>
function confirmFormat(warning) {{
  return confirm(warning) &&
         confirm('Wirklich ganz sicher? Formatieren löscht alle vorhandenen Daten auf dem Stick unwiderruflich.');
}}
function startFormat(form, warning) {{
  if (!confirmFormat(warning)) return false;
  var modal = document.getElementById('format-modal');
  var content = document.getElementById('format-modal-content');
  content.innerHTML = '<h1><span class="spinner"></span>Formatiere…</h1>' +
    '<p class="muted">Bitte warten – das kann je nach Stick-Größe einige Minuten dauern.</p>';
  modal.classList.add('show');
  fetch('/backup/usb/format', {{method: 'POST', body: new URLSearchParams(new FormData(form))}});
  (function poll() {{
    fetch('/backup/usb/format-status').then(r => r.json()).then(function(d) {{
      if (!d.done) {{ setTimeout(poll, 2000); return; }}
      content.innerHTML = d.ok
        ? '<div class="msg ok">✅ ' + d.detail + '</div>'
        : '<div class="msg err">❌ ' + d.detail + '</div>';
      setTimeout(function() {{ window.location.reload(); }}, 2000);
    }}).catch(function() {{ setTimeout(poll, 2000); }});
  }})();
  return false;
}}
</script>
</body></html>
"""

PAGE_RESTORE = """<!doctype html>
<html lang="de"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Backup wiederherstellen</title>
<style>""" + STYLE + """</style>
</head><body>
{header}
<h1>♻ Backup wiederherstellen</h1>
<p>Ersetzt Datenbank <strong>und Fotos</strong> durch den gewählten Stand.
Der App-Code bleibt unangetastet. BeeTown startet danach automatisch neu
und ist sofort wieder voll funktionsfähig.</p>
{message}
<form method="post" action="/backup/restore"
      onsubmit="return confirmRestore(this.querySelector('select').selectedOptions[0]
                ? this.querySelector('select').selectedOptions[0].text : 'diesem Backup')">
  <label for="backup_select">Vorhandenes Backup auswählen</label>
  <select id="backup_select" name="backup_key">
    {options}
  </select>
  <button type="submit" class="btn-danger">Backup wiederherstellen</button>
</form>

<h2 style="font-size:1.05rem; margin-top:2rem;">Backup direkt vom PC wiederherstellen</h2>
<form method="post" action="/backup/restore-upload" enctype="multipart/form-data"
      onsubmit="return confirmRestore('der ausgewählten Datei')">
  <label for="upload_file">Backup-Datei auf diesem PC auswählen (.tar.gz)</label>
  <input type="file" id="upload_file" name="file" accept=".gz,.tar.gz" required>
  <button type="submit" class="btn-danger">Backup vom PC wiederherstellen</button>
</form>

<a class="btn" href="/backup">← Zurück zu den Backups</a>
<script>
function confirmRestore(name) {{
  return confirm('Datenbank und Fotos wirklich aus "' + name + '" wiederherstellen? ' +
                 'Alle Änderungen seit diesem Backup gehen dabei verloren.') &&
         confirm('Ganz sicher? Dieser Schritt lässt sich nicht rückgängig machen.');
}}
</script>
</body></html>
"""

PAGE_DOWNLOAD_SELECT = """<!doctype html>
<html lang="de"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Backup herunterladen</title>
<style>""" + STYLE + """</style>
</head><body>
{header}
<h1>⬇ Backup herunterladen</h1>
<p>Lädt das gewählte Backup-Archiv (Datenbank + Fotos) auf dieses Gerät
herunter.</p>
<form onsubmit="event.preventDefault(); var v = document.getElementById('download_select').value;
                if (v) window.location.href = '/backup/download/' + v.replace('|', '/');">
  <label for="download_select">Vorhandenes Backup auswählen</label>
  <select id="download_select" name="backup_key">
    {options}
  </select>
  <button type="submit">⬇ Backup herunterladen</button>
</form>
<a class="btn" href="/backup">← Zurück zu den Backups</a>
</body></html>
"""

PAGE_UPDATE = """<!doctype html>
<html lang="de"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Update</title>
<style>""" + STYLE + """</style>
</head><body>
{header}
<h1>🔄 Update</h1>
<p>Prüft auf GitHub, ob eine neuere BeeTown-Version verfügbar ist. Vor jedem
Update wird automatisch ein Backup erstellt (Datenbank + Fotos) – der
Programm-Code selbst kommt ohnehin direkt von GitHub.</p>
{message}
<div class="msg {status_class}">
<strong>Installierte Version:</strong> {current}<br>
<strong>Neueste Version:</strong> {latest}
</div>
{notes_block}
{action_block}
<a class="btn" href="/">← Zurück zur Übersicht</a>

<div id="update-modal" class="modal-backdrop">
  <div class="modal-box" id="update-modal-content"></div>
</div>
<script>
function startUpdate(tag) {{
  if (!confirm('Auf Version ' + tag + ' aktualisieren? Vorher wird automatisch ein Backup erstellt.')) {{
    return false;
  }}
  var modal = document.getElementById('update-modal');
  var content = document.getElementById('update-modal-content');
  content.innerHTML = '<h1><span class="spinner"></span>Aktualisiere…</h1>' +
    '<p class="muted">Backup wird erstellt, neue Version heruntergeladen und installiert. ' +
    'Das kann einige Minuten dauern – bitte die Seite nicht schließen.</p>';
  modal.classList.add('show');
  fetch('/update/run', {{method: 'POST'}});
  (function poll() {{
    fetch('/update/status').then(r => r.json()).then(function(d) {{
      if (!d.done) {{ setTimeout(poll, 2000); return; }}
      content.innerHTML = d.ok
        ? '<div class="msg ok">✅ ' + d.detail + '</div>'
        : '<div class="msg err">❌ ' + d.detail + '</div>';
      setTimeout(function() {{ window.location.reload(); }}, 2500);
    }}).catch(function() {{ setTimeout(poll, 2000); }});
  }})();
  return false;
}}
</script>
</body></html>
"""

PAGE_SYSTEM_ACTION = """<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{action}…</title>
<style>""" + STYLE + """</style>
</head><body>
<h1><span class="spinner"></span>Pi {verb}…</h1>
<p>{hint}</p>
{retry_script}
</body></html>
"""

RETRY_SCRIPT = """
<script>
setTimeout(function poll() {
  fetch('/', {cache: 'no-store'}).then(function(r) {
    if (r.ok) { window.location.href = '/'; } else { setTimeout(poll, 3000); }
  }).catch(function() { setTimeout(poll, 3000); });
}, 15000);
</script>
"""

STOP_SPINNER_SCRIPT = """
<script>
setTimeout(function() {
  var el = document.querySelector('.spinner');
  if (el) { el.style.animation = 'none'; el.style.borderColor = '#999'; el.style.borderTopColor = '#999'; }
}, 20000);
</script>
"""


def scan_networks():
    try:
        out = subprocess.run(
            ["nmcli", "-t", "-f", "SSID,SIGNAL", "device", "wifi", "list", "--rescan", "yes"],
            capture_output=True, text=True, timeout=15,
        ).stdout
    except Exception:
        return []
    seen, nets = set(), []
    for line in out.splitlines():
        if not line or ":" not in line:
            continue
        ssid, _, signal = line.rpartition(":")
        ssid = ssid.strip()
        if not ssid or ssid in seen:
            continue
        seen.add(ssid)
        nets.append((ssid, signal))
    nets.sort(key=lambda t: int(t[1] or 0), reverse=True)
    return nets


def current_wifi_connection():
    """(ssid, connected) fuer wlan0 - ssid ist None wenn nicht verbunden."""
    try:
        out = subprocess.run(
            ["nmcli", "-t", "-f", "DEVICE,STATE,CONNECTION", "device", "status"],
            capture_output=True, text=True, timeout=10,
        ).stdout
    except Exception:
        return None, False
    for line in out.splitlines():
        parts = line.split(":")
        if len(parts) >= 3 and parts[0] == "wlan0":
            connected = parts[1] == "connected"
            ssid = parts[2] if connected and parts[2] != "--" else None
            return ssid, connected
    return None, False


def get_ip(iface):
    try:
        out = subprocess.run(
            ["nmcli", "-g", "IP4.ADDRESS", "device", "show", iface],
            capture_output=True, text=True, timeout=5,
        ).stdout.strip()
    except Exception:
        return None
    return out.split("/")[0] if out else None


def status_banner():
    ssid, connected = current_wifi_connection()
    if connected:
        return f'<div class="msg ok">📶 Aktuell verbunden mit <strong>{ssid}</strong></div>'
    return '<div class="msg err">📡 Kein WLAN verbunden</div>'


def list_backups(directory):
    try:
        names = [f for f in os.listdir(directory) if BACKUP_NAME_RE.match(f)]
    except Exception:
        return []
    names.sort(reverse=True)
    backups = []
    for name in names:
        path = os.path.join(directory, name)
        try:
            st = os.stat(path)
            size_mb = f"{st.st_size / (1024 * 1024):.1f}"
            mtime = time.strftime("%Y-%m-%d %H:%M", time.localtime(st.st_mtime))
        except OSError:
            size_mb, mtime = "?", "?"
        backups.append({"name": name, "size_mb": size_mb, "mtime": mtime})
    return backups


def create_backup_now():
    try:
        result = subprocess.run(["bash", BACKUP_SCRIPT], capture_output=True, text=True, timeout=180)
    except Exception as e:
        return False, str(e)
    return result.returncode == 0, (result.stderr or result.stdout).strip()


def _restore_from_tar(tar, label):
    """Ersetzt den kompletten /opt/imkerei/data-Ordner (Datenbank + Fotos)
    durch den Inhalt des geoeffneten tar-Archivs. App-Code bleibt
    unangetastet. Startet den App-Dienst danach wieder, damit BeeTown
    sofort wieder voll funktioniert."""
    subprocess.run(["systemctl", "stop", "imkerei.service"], capture_output=True, text=True)
    try:
        members = [m for m in tar.getmembers()
                  if m.name == BACKUP_DATA_PREFIX or m.name.startswith(BACKUP_DATA_PREFIX + "/")]
        if not members:
            return False, f"'{BACKUP_DATA_PREFIX}' nicht im Archiv gefunden."
        with tempfile.TemporaryDirectory() as tmpdir:
            tar.extractall(path=tmpdir, members=members)
            extracted_data_dir = os.path.join(tmpdir, BACKUP_DATA_PREFIX)
            if os.path.isdir("/opt/imkerei/data"):
                shutil.rmtree("/opt/imkerei/data")
            shutil.move(extracted_data_dir, "/opt/imkerei/data")
        subprocess.run(["chown", "-R", "imkerei:imkerei", "/opt/imkerei/data"],
                       capture_output=True, text=True)
    except Exception as e:
        subprocess.run(["systemctl", "start", "imkerei.service"], capture_output=True, text=True)
        return False, f"Fehler bei der Wiederherstellung: {e}"
    subprocess.run(["systemctl", "start", "imkerei.service"], capture_output=True, text=True)
    return True, f"Datenbank und Fotos aus '{label}' wiederhergestellt – BeeTown läuft wieder."


def restore_backup(location, filename):
    if not filename or not BACKUP_NAME_RE.match(filename):
        return False, "Ungültiger Dateiname."
    directory = USB_MOUNT if location == "usb" else BACKUP_DIR
    path = os.path.join(directory, filename)
    if not os.path.isfile(path):
        return False, "Backup nicht gefunden."
    try:
        with tarfile.open(path, "r:gz") as tar:
            return _restore_from_tar(tar, filename)
    except Exception as e:
        return False, f"Fehler beim Lesen des Archivs: {e}"


def restore_backup_from_bytes(data, filename):
    try:
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
            return _restore_from_tar(tar, filename or "der hochgeladenen Datei")
    except Exception as e:
        return False, f"Fehler beim Lesen der hochgeladenen Datei: {e}"


def parse_multipart_file(body, content_type):
    """Sehr einfacher multipart/form-data-Parser fuer genau EIN Datei-Feld
    (keine externen Abhaengigkeiten, Python-Standardbibliothek reicht).
    Gibt (dateiname, bytes) oder (None, None) zurueck."""
    m = re.search(r'boundary="?([^";]+)"?', content_type)
    if not m:
        return None, None
    boundary = ("--" + m.group(1)).encode()
    for part in body.split(boundary):
        if b"Content-Disposition" not in part:
            continue
        header_end = part.find(b"\r\n\r\n")
        if header_end == -1:
            continue
        headers = part[:header_end].decode("utf-8", "replace")
        data = part[header_end + 4:]
        if data.endswith(b"\r\n"):
            data = data[:-2]
        fm = re.search(r'filename="([^"]*)"', headers)
        if fm and fm.group(1):
            return fm.group(1), data
    return None, None


def get_backup_schedule():
    try:
        with open(BACKUP_TIMER_PATH) as f:
            content = f.read()
    except Exception:
        return "daily"
    m = re.search(r"^OnCalendar=(.+)$", content, re.MULTILINE)
    if not m:
        return "daily"
    value = m.group(1).strip()
    for key, calendar in BACKUP_SCHEDULES.items():
        if value == calendar:
            return key
    return "daily"


def get_max_backups():
    try:
        with open(BACKUP_CONFIG_PATH) as f:
            content = f.read()
        m = re.search(r"^MAX_BACKUPS=(\d+)", content, re.MULTILINE)
        if m:
            return int(m.group(1))
    except Exception:
        pass
    return DEFAULT_MAX_BACKUPS


def set_backup_settings(schedule, max_backups_raw):
    if schedule not in BACKUP_SCHEDULES:
        return False, "Ungültiger Zeitplan."
    try:
        max_backups = int(max_backups_raw)
    except (TypeError, ValueError):
        return False, "Ungültige Anzahl."
    if not (1 <= max_backups <= 100):
        return False, "Anzahl muss zwischen 1 und 100 liegen."
    try:
        with open(BACKUP_TIMER_PATH) as f:
            content = f.read()
        new_content = re.sub(r"^OnCalendar=.*$", f"OnCalendar={BACKUP_SCHEDULES[schedule]}",
                             content, flags=re.MULTILINE)
        with open(BACKUP_TIMER_PATH, "w") as f:
            f.write(new_content)
        os.makedirs(os.path.dirname(BACKUP_CONFIG_PATH), exist_ok=True)
        with open(BACKUP_CONFIG_PATH, "w") as f:
            f.write(f"MAX_BACKUPS={max_backups}\n")
        subprocess.run(["systemctl", "daemon-reload"], capture_output=True, text=True)
        subprocess.run(["systemctl", "restart", "imkerei-backup.timer"], capture_output=True, text=True)
    except Exception as e:
        return False, str(e)
    return True, f"Zeitplan und Aufbewahrung (max. {max_backups} Backups je Ort) gespeichert."


def get_root_disk():
    """Name (z. B. 'mmcblk0') der Festplatte, von der das System bootet."""
    try:
        src = subprocess.run(["findmnt", "-n", "-o", "SOURCE", "/"],
                             capture_output=True, text=True, timeout=5).stdout.strip()
        pkname = subprocess.run(["lsblk", "-no", "PKNAME", src],
                                capture_output=True, text=True, timeout=5).stdout.strip()
        return pkname or re.sub(r"p?\d+$", "", src.replace("/dev/", ""))
    except Exception:
        return None


def list_usb_disks():
    """Per USB angeschlossene Festplatten, OHNE die System-Platte - reine
    Sicherheitsmassnahme, damit diese niemals formatierbar angeboten wird."""
    root_disk = get_root_disk()
    try:
        out = subprocess.run(
            ["lsblk", "-J", "-o", "NAME,TRAN,SIZE,FSTYPE,LABEL,MOUNTPOINT,TYPE"],
            capture_output=True, text=True, timeout=10,
        ).stdout
        data = json.loads(out)
    except Exception:
        return []
    disks = []
    for dev in data.get("blockdevices", []):
        if dev.get("type") != "disk" or dev.get("tran") != "usb":
            continue
        if dev.get("name") == root_disk:
            continue
        mountpoints = [dev.get("mountpoint")] + [c.get("mountpoint") for c in dev.get("children", []) or []]
        labels = [dev.get("label")] + [c.get("label") for c in dev.get("children", []) or []]
        disks.append({
            "name": dev["name"],
            "size": dev.get("size") or "?",
            "fstype": dev.get("fstype") or "unformatiert",
            "is_target": USB_MOUNT in mountpoints,
            # Label "BACKUP" wird beim Formatieren durch diese App gesetzt - so
            # erkennen wir einen bereits eingerichteten Stick wieder, auch nach
            # einer Neuinstallation (bei der die fstab-Verknuepfung verloren
            # ging, der Stick selbst aber weiterhin seine Backups enthaelt).
            "is_known_backup_stick": "BACKUP" in [l for l in labels if l],
        })
    return disks


def _register_fstab_and_mount(device):
    """Traegt das Dateisystem von `device` (per UUID) in /etc/fstab fuer
    USB_MOUNT ein und haengt es ein. Gemeinsame Logik fuer Formatieren
    (neuer Stick) und Einbinden (bereits eingerichteter Stick, z. B. nach
    einer Neuinstallation des Pi, bei der die alte fstab-Zeile verloren
    ging). Gibt (True, None) oder (False, Fehlertext) zurueck."""
    uuid = subprocess.run(["blkid", "-s", "UUID", "-o", "value", device],
                         capture_output=True, text=True, timeout=10).stdout.strip()
    if not uuid:
        return False, "UUID des Dateisystems konnte nicht ermittelt werden."

    os.makedirs(USB_MOUNT, exist_ok=True)
    try:
        try:
            with open("/etc/fstab") as f:
                lines = [l for l in f if USB_MOUNT not in l]
        except FileNotFoundError:
            lines = []
        lines.append(f"UUID={uuid} {USB_MOUNT} ext4 defaults,nofail,x-systemd.device-timeout=5 0 2\n")
        with open("/etc/fstab", "w") as f:
            f.writelines(lines)
    except Exception as e:
        return False, f"/etc/fstab konnte nicht aktualisiert werden: {e}"

    subprocess.run(["systemctl", "daemon-reload"], capture_output=True, text=True)
    mount_result = subprocess.run(["mount", USB_MOUNT], capture_output=True, text=True, timeout=30)
    if mount_result.returncode != 0:
        return False, f"Einhängen fehlgeschlagen: {(mount_result.stderr or mount_result.stdout).strip()}"
    return True, None


def format_and_setup_usb(device_name):
    if not re.match(r"^[a-z][a-z0-9]*$", device_name or ""):
        return False, "Ungültiger Gerätename."
    root_disk = get_root_disk()
    if device_name == root_disk:
        return False, "Sicherheitsstopp: das ist die System-Festplatte - wird nicht formatiert."
    if device_name not in {d["name"] for d in list_usb_disks()}:
        return False, "Gerät ist kein erkannter USB-Stick."
    device = f"/dev/{device_name}"

    subprocess.run(["umount", USB_MOUNT], capture_output=True, text=True)
    subprocess.run(["umount", device], capture_output=True, text=True)
    for i in range(1, 5):
        subprocess.run(["umount", f"{device}{i}"], capture_output=True, text=True)

    result = subprocess.run(["mkfs.ext4", "-F", "-L", "BACKUP", device],
                            capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        return False, f"Formatieren fehlgeschlagen: {(result.stderr or result.stdout).strip()}"

    ok, err = _register_fstab_and_mount(device)
    if not ok:
        return False, f"Formatiert, aber {err}"
    return True, f"USB-Stick formatiert und als zusätzliches Backup-Ziel eingerichtet ({USB_MOUNT})."


def mount_existing_usb(device_name):
    """Bindet einen USB-Stick ein, der bereits frueher (z. B. auf einer
    vorherigen Installation dieses Pi) als Backup-Ziel formatiert wurde -
    OHNE ihn neu zu formatieren. Noetig, weil die fstab-Verknuepfung bei
    einer Neuinstallation des Pi verloren geht, der Stick selbst mit seinen
    Backups aber unveraendert bleibt."""
    if not re.match(r"^[a-z][a-z0-9]*$", device_name or ""):
        return False, "Ungültiger Gerätename."
    root_disk = get_root_disk()
    if device_name == root_disk:
        return False, "Sicherheitsstopp: das ist die System-Festplatte."
    if device_name not in {d["name"] for d in list_usb_disks()}:
        return False, "Gerät ist kein erkannter USB-Stick."
    device = f"/dev/{device_name}"

    ok, err = _register_fstab_and_mount(device)
    if not ok:
        return False, err
    return True, f"Vorhandener USB-Stick eingebunden ({USB_MOUNT}) – bestehende Backups sind erhalten."


def eject_usb():
    result = subprocess.run(["umount", USB_MOUNT], capture_output=True, text=True, timeout=15)
    return result.returncode == 0, (result.stderr or result.stdout).strip()


def try_remount_usb():
    """Bestversuch: haengt einen bereits eingerichteten USB-Stick (per
    /etc/fstab-Eintrag) automatisch wieder ein, falls er zwischenzeitlich
    ab- und wieder angesteckt wurde, ohne dass der Pi neu gestartet wurde.
    Wirkungslos und ungefaehrlich, falls schon eingehaengt oder kein
    passendes Geraet vorhanden."""
    if os.path.ismount(USB_MOUNT):
        return
    subprocess.run(["mount", USB_MOUNT], capture_output=True, text=True, timeout=15)


def _run_format_in_background(device_name):
    ok, detail = format_and_setup_usb(device_name)
    FORMAT_STATE.update(done=True, ok=ok, detail=detail)


def disk_usage(path):
    try:
        usage = shutil.disk_usage(path)
        free_gb = usage.free / (1024 ** 3)
        total_gb = usage.total / (1024 ** 3)
        return f"{free_gb:.1f} GB frei von {total_gb:.1f} GB"
    except Exception:
        return "?"


def render_backup_page(message="", skip_remount=False):
    # skip_remount=True direkt nach einem bewussten Aushaengen verwenden -
    # sonst wuerde try_remount_usb() den Stick (der Eintrag in /etc/fstab
    # bleibt beim Aushaengen ja bestehen) sofort wieder automatisch mounten.
    if not skip_remount:
        try_remount_usb()
    usb_mounted = os.path.ismount(USB_MOUNT)
    usb_disks = list_usb_disks()
    usb_section_parts = []
    if usb_mounted:
        usb_section_parts.append(
            f'<div class="msg ok">📦 USB-Stick eingerichtet ({disk_usage(USB_MOUNT)}) – '
            f'Backups werden zusätzlich zur SD-Karte dort abgelegt.</div>'
        )
        usb_section_parts.append(
            '<form method="post" action="/backup/usb/eject" '
            'onsubmit="return confirm(\'USB-Stick sicher aushängen? Danach kann er entfernt werden.\');">'
            '<button type="submit">⏏ USB-Stick sicher entfernen</button></form>'
        )
    elif usb_disks:
        for d in usb_disks:
            if d.get("is_known_backup_stick"):
                usb_section_parts.append(f"""
<div class="msg ok">
  Bekannter Backup-Stick gefunden: <strong>/dev/{d['name']}</strong> ({d['size']}) –
  aktuell nicht eingebunden (z. B. nach einer Neuinstallation dieses Pi).
  Vorhandene Backups bleiben beim Einbinden erhalten.
  <form method="post" action="/backup/usb/mount">
    <input type="hidden" name="device" value="{d['name']}">
    <button type="submit">📌 Vorhandenen Stick einbinden</button>
  </form>
</div>""")
                continue
            warn = (f"USB-Stick /dev/{d['name']} ({d['size']}, {d['fstype']}) wirklich formatieren? "
                    f"ALLE Daten darauf gehen unwiderruflich verloren!")
            usb_section_parts.append(f"""
<div class="msg err">
  USB-Stick gefunden: <strong>/dev/{d['name']}</strong> ({d['size']}, {d['fstype']}) –
  noch nicht als Backup-Ziel eingerichtet.
  <form onsubmit="return startFormat(this, '{warn}')">
    <input type="hidden" name="device" value="{d['name']}">
    <button type="submit" class="btn-danger">⚙ Formatieren &amp; als Backup-Ziel einrichten</button>
  </form>
</div>""")
    else:
        usb_section_parts.append('<p>Kein USB-Stick angeschlossen.</p>')

    schedule = get_backup_schedule()
    return PAGE_BACKUP.format(
        header=render_header(),
        message=message,
        usb_section="".join(usb_section_parts),
        daily_selected="selected" if schedule == "daily" else "",
        weekly_selected="selected" if schedule == "weekly" else "",
        max_backups=get_max_backups(),
    )


def app_version():
    try:
        with open("/opt/imkerei/static/app.js") as f:
            content = f.read()
        m = re.search(r"APP_VERSION\s*=\s*['\"]([^'\"]+)['\"]", content)
        if m:
            return m.group(1)
    except Exception:
        pass
    return "?"


def render_header():
    return PAGE_HEADER.format(app_version=app_version())


def backup_options_html():
    try_remount_usb()
    entries = [(b, "local", "SD-Karte") for b in list_backups(BACKUP_DIR)]
    if os.path.ismount(USB_MOUNT):
        entries += [(b, "usb", "USB-Stick") for b in list_backups(USB_MOUNT)]
    entries.sort(key=lambda e: e[0]["name"], reverse=True)
    if not entries:
        return '<option value="">– keine Backups vorhanden –</option>'
    return "".join(
        f'<option value="{loc}|{b["name"]}">{b["name"]} ({b["mtime"]}, {label})</option>'
        for b, loc, label in entries)


def render_restore_page(message=""):
    return PAGE_RESTORE.format(
        header=render_header(),
        message=message,
        options=backup_options_html(),
    )


def render_download_select_page():
    return PAGE_DOWNLOAD_SELECT.format(
        header=render_header(),
        options=backup_options_html(),
    )


def parse_version(v):
    """'v2.7.4' -> (2, 7, 4), fuer korrekten numerischen Vergleich (nicht
    alphabetisch - sonst waere z. B. 'v2.10' < 'v2.9')."""
    parts = []
    for p in (v or "").lstrip("vV").split("."):
        m = re.match(r"\d+", p)
        parts.append(int(m.group()) if m else 0)
    return tuple(parts) or (0,)


def fetch_latest_release():
    """Fragt die GitHub-Releases-API ab. Gibt dict mit tag, name, notes,
    tarball_url zurueck, oder None bei Fehler (kein Internet, keine
    Releases, GitHub nicht erreichbar)."""
    try:
        req = urllib.request.Request(
            GITHUB_LATEST_RELEASE_URL,
            headers={"Accept": "application/vnd.github+json", "User-Agent": "BeeTown-Update-Check"},
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        tag = data.get("tag_name") or ""
        if not tag:
            return None
        return {
            "tag": tag,
            "notes": (data.get("body") or "").strip(),
            "tarball_url": data.get("tarball_url") or "",
        }
    except Exception:
        return None


def run_update_check_once():
    """Einmaliger Versions-Check, Ergebnis wird zwischengespeichert (per
    Timer regelmaessig aufgerufen) - so muss die Startseite nicht bei jedem
    Aufruf selbst GitHub kontaktieren, sondern zeigt nur den zwischengespeicherten
    Stand als Badge an."""
    current = app_version()
    release = fetch_latest_release()
    state = {
        "current": current,
        "latest": release["tag"] if release else None,
        "update_available": bool(release) and parse_version(release["tag"]) > parse_version(current),
        "checked_at": time.strftime("%Y-%m-%d %H:%M"),
    }
    try:
        os.makedirs(os.path.dirname(UPDATE_CHECK_STATE_PATH), exist_ok=True)
        with open(UPDATE_CHECK_STATE_PATH, "w") as f:
            json.dump(state, f)
    except Exception:
        pass


def read_update_check_state():
    try:
        with open(UPDATE_CHECK_STATE_PATH) as f:
            return json.load(f)
    except Exception:
        return {"current": app_version(), "latest": None, "update_available": False, "checked_at": None}


def perform_update(tarball_url, target_tag):
    """Legt zuerst ein Backup an, laedt dann den Source-Tarball des GitHub-
    Release herunter und ersetzt server.py + static/ (data/ bleibt
    unangetastet). Gibt (True, Meldung) oder (False, Fehlertext) zurueck."""
    ok, detail = create_backup_now()
    if not ok:
        return False, f"Backup vor dem Update fehlgeschlagen - Update abgebrochen: {detail}"
    try:
        req = urllib.request.Request(tarball_url, headers={"User-Agent": "BeeTown-Update"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            archive_data = resp.read()
    except Exception as e:
        return False, f"Herunterladen fehlgeschlagen: {e}"

    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            with tarfile.open(fileobj=io.BytesIO(archive_data), mode="r:gz") as tar:
                tar.extractall(path=tmpdir)
            entries = os.listdir(tmpdir)
            if len(entries) != 1:
                return False, "Unerwarteter Archivinhalt (GitHub-Tarball-Struktur hat sich geaendert)."
            src_root = os.path.join(tmpdir, entries[0])
            new_server = os.path.join(src_root, "server.py")
            new_static = os.path.join(src_root, "static")
            if not os.path.isfile(new_server) or not os.path.isdir(new_static):
                return False, "server.py oder static/ nicht im heruntergeladenen Archiv gefunden."

            subprocess.run(["systemctl", "stop", "imkerei.service"], capture_output=True, text=True)
            shutil.copy(new_server, "/opt/imkerei/server.py")
            if os.path.isdir("/opt/imkerei/static"):
                shutil.rmtree("/opt/imkerei/static")
            shutil.copytree(new_static, "/opt/imkerei/static")
            subprocess.run(["chown", "-R", "imkerei:imkerei", "/opt/imkerei/server.py", "/opt/imkerei/static"],
                           capture_output=True, text=True)
    except Exception as e:
        subprocess.run(["systemctl", "start", "imkerei.service"], capture_output=True, text=True)
        return False, f"Fehler beim Aktualisieren: {e}"

    subprocess.run(["systemctl", "start", "imkerei.service"], capture_output=True, text=True)
    return True, f"Auf Version {target_tag} aktualisiert - BeeTown läuft wieder."


def _run_update_in_background():
    release = fetch_latest_release()
    if not release or not release.get("tarball_url"):
        UPDATE_STATE.update(done=True, ok=False, detail="Neueste Version konnte nicht ermittelt werden.")
        return
    ok, detail = perform_update(release["tarball_url"], release["tag"])
    UPDATE_STATE.update(done=True, ok=ok, detail=detail)
    run_update_check_once()  # Zwischenspeicher aktualisieren - Badge auf der Startseite verschwindet


def render_update_page(message=""):
    current = app_version()
    release = fetch_latest_release()
    if release is None:
        latest = "konnte nicht abgerufen werden"
        status_class = "err"
        notes_block = ""
        action_block = '<p class="muted">Prüfe, ob der Pi Internetzugang hat, und lade die Seite neu.</p>'
    else:
        latest = release["tag"]
        update_available = parse_version(latest) > parse_version(current)
        status_class = "err" if update_available else "ok"
        notes_block = (f'<div class="msg" style="white-space:pre-wrap;">{release["notes"]}</div>'
                       if update_available and release["notes"] else "")
        if update_available:
            action_block = (
                f'<form onsubmit="return startUpdate(\'{latest}\')">'
                f'<button type="submit" class="btn-danger">⬇ Auf {latest} aktualisieren</button>'
                f'</form>'
            )
        else:
            action_block = '<p class="muted">Du hast bereits die neueste Version.</p>'
    return PAGE_UPDATE.format(
        header=render_header(), message=message, current=current, latest=latest,
        status_class=status_class, notes_block=notes_block, action_block=action_block,
    )


def render_landing():
    update_state = read_update_check_state()
    update_banner = ""
    if update_state.get("update_available"):
        update_banner = f'<div class="msg ok">🔄 Update verfügbar: Version {update_state["latest"]}</div>'
    return PAGE_LANDING.format(
        header=render_header(),
        status=status_banner(),
        update_banner=update_banner,
        app_url=app_url(),
        wifi_url=wifi_url(),
        eth0_ip=get_ip("eth0") or "nicht verbunden",
        wlan0_ip=get_ip("wlan0") or "nicht verbunden",
    )


def render_form(message=""):
    nets = scan_networks()
    if nets:
        options = "".join(f'<option value="{s}">{s}</option>' for s, _ in nets)
        ssid_field = (
            f'<select id="ssid" name="ssid">{options}'
            f'<option value="">– manuell eingeben –</option></select>'
            f'<input id="ssid_manual" name="ssid_manual" placeholder="SSID manuell" style="margin-top:.5rem">'
        )
    else:
        ssid_field = '<input id="ssid" name="ssid" placeholder="SSID">' \
                     '<input id="ssid_manual" name="ssid_manual" style="display:none">'
    _, connected = current_wifi_connection()
    return PAGE_FORM.format(
        header=render_header(),
        status=status_banner(),
        app_url=app_url(),
        landing_url=landing_url(),
        message=message,
        ssid_field=ssid_field,
        disconnect_form=DISCONNECT_FORM if connected else "",
    )


def app_url():
    host = f"http://{socket.gethostname()}.local"
    return host if APP_PORT == 80 else f"{host}:{APP_PORT}"


def wifi_url():
    host = f"http://{socket.gethostname()}.local"
    return host if PORT_WIFI == 80 else f"{host}:{PORT_WIFI}"


def landing_url():
    host = f"http://{socket.gethostname()}.local"
    return host if PORT_LANDING == 80 else f"{host}:{PORT_LANDING}"


def previously_active_connection():
    """Name des aktuell aktiven Verbindungsprofils auf wlan0 (oder None)."""
    try:
        out = subprocess.run(
            ["nmcli", "-t", "-f", "NAME,DEVICE", "connection", "show", "--active"],
            capture_output=True, text=True, timeout=10,
        ).stdout
    except Exception:
        return None
    for line in out.splitlines():
        name, _, device = line.partition(":")
        if device == "wlan0":
            return name
    return None


def connect_wifi(ssid, password):
    previous = previously_active_connection()
    if previous == ssid:
        previous = None  # Verbindung zum gleichen Netz - kein Rueckfall noetig

    # Eventuell vorhandenes altes Verbindungsprofil mit gleichem Namen wie das
    # NEUE Ziel-WLAN zuerst entfernen: nmcli versucht sonst manchmal, ein
    # bestehendes Profil zu aktualisieren statt ein frisches anzulegen, wobei
    # die Sicherheits-Konfiguration verloren gehen kann ("key-mgmt: property
    # is missing"). Fehler wird ignoriert, falls kein solches Profil existiert.
    subprocess.run(["nmcli", "connection", "delete", ssid], capture_output=True, text=True)

    cmd = ["nmcli", "device", "wifi", "connect", ssid, "ifname", "wlan0"]
    if password:
        cmd += ["password", password]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=45)
    ok = result.returncode == 0
    detail = (result.stderr or result.stdout).strip()

    if not ok and previous:
        # Ein WLAN-Chip kann immer nur mit einem Netz gleichzeitig verbunden
        # sein - der Verbindungsversuch zum neuen Netz hat die alte
        # Verbindung daher zwangslaeufig kurz unterbrochen. Schlaegt der neue
        # Versuch fehl, automatisch auf die alte, funktionierende Verbindung
        # zurueckfallen, damit der Pi nicht unerreichbar bleibt.
        rollback = subprocess.run(
            ["nmcli", "connection", "up", previous],
            capture_output=True, text=True, timeout=30,
        )
        if rollback.returncode == 0:
            detail += f" (alte Verbindung '{previous}' wiederhergestellt)"
        else:
            detail += f" (Wiederherstellen von '{previous}' ebenfalls fehlgeschlagen!)"

    return ok, detail


def disconnect_wifi():
    name = previously_active_connection()
    if name:
        # autoconnect abschalten, sonst verbindet NetworkManager das
        # gespeicherte Profil sofort wieder automatisch neu.
        subprocess.run(["nmcli", "connection", "modify", name, "autoconnect", "no"],
                       capture_output=True, text=True)
    result = subprocess.run(["nmcli", "device", "disconnect", "wlan0"],
                            capture_output=True, text=True, timeout=15)
    return result.returncode == 0, (result.stderr or result.stdout).strip()


def _delayed_system_call(cmd):
    time.sleep(1.5)
    subprocess.run(cmd)


class BaseHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _send_html(self, body, status=200):
        data = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _send_json(self, obj):
        data = json.dumps(obj).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def serve_logo(self):
        try:
            with open("/opt/imkerei/static/icon-192.png", "rb") as f:
                data = f.read()
        except Exception:
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", "image/png")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "max-age=3600")
        self.end_headers()
        self.wfile.write(data)

    def handle_system_action(self):
        """True, wenn der Pfad eine System-Aktion war (Reboot/Shutdown)."""
        if self.path == "/system/reboot":
            self._send_html(PAGE_SYSTEM_ACTION.format(
                action="Neustart", verb="startet neu",
                hint="Diese Seite versucht in Kürze automatisch, sich neu zu verbinden, "
                     "und lädt sich dann selbst neu.",
                retry_script=RETRY_SCRIPT,
            ))
            threading.Thread(target=_delayed_system_call, args=(["systemctl", "reboot"],), daemon=True).start()
            return True
        if self.path == "/system/shutdown":
            self._send_html(PAGE_SYSTEM_ACTION.format(
                action="Herunterfahren", verb="fährt herunter",
                hint="Der Pi muss danach manuell wieder eingeschaltet werden "
                     "(Strom trennen/verbinden).",
                retry_script=STOP_SPINNER_SCRIPT,
            ))
            threading.Thread(target=_delayed_system_call, args=(["systemctl", "poweroff"],), daemon=True).start()
            return True
        return False


class LandingHandler(BaseHandler):
    def do_GET(self):
        if self.path == "/logo.png":
            self.serve_logo()
            return
        if self.path == "/tipps":
            self._send_html(PAGE_TIPPS.format(header=render_header()))
            return
        if self.path == "/backup":
            self._send_html(render_backup_page())
            return
        if self.path == "/backup/restore":
            self._send_html(render_restore_page())
            return
        if self.path == "/backup/downloads":
            self._send_html(render_download_select_page())
            return
        if self.path == "/backup/usb/format-status":
            self._send_json(FORMAT_STATE)
            return
        if self.path == "/update":
            self._send_html(render_update_page())
            return
        if self.path == "/update/status":
            self._send_json(UPDATE_STATE)
            return
        if self.path.startswith("/backup/download/"):
            rest = unquote(self.path[len("/backup/download/"):])
            location, _, filename = rest.partition("/")
            self._serve_backup_download(location, filename)
            return
        self._send_html(render_landing())

    def _serve_backup_download(self, location, filename):
        if location not in ("local", "usb") or not BACKUP_NAME_RE.match(filename):
            self.send_response(400)
            self.end_headers()
            return
        directory = USB_MOUNT if location == "usb" else BACKUP_DIR
        path = os.path.join(directory, filename)
        if not os.path.isfile(path):
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/gzip")
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_header("Content-Length", str(os.path.getsize(path)))
        self.end_headers()
        with open(path, "rb") as f:
            shutil.copyfileobj(f, self.wfile)

    def do_POST(self):
        if self.handle_system_action():
            return
        if self.path == "/backup/create":
            ok, detail = create_backup_now()
            msg = ('<div class="msg ok">✅ Backup erstellt.</div>' if ok
                   else f'<div class="msg err">Fehler: {detail}</div>')
            self._send_html(render_backup_page(msg))
            return
        if self.path == "/backup/restore":
            length = int(self.headers.get("Content-Length", 0))
            fields = parse_qs(self.rfile.read(length).decode("utf-8"))
            backup_key = fields.get("backup_key", [""])[0]
            location, _, filename = backup_key.partition("|")
            if not filename:
                self._send_html(render_restore_page('<div class="msg err">Bitte ein Backup auswählen.</div>'))
                return
            ok, detail = restore_backup(location, filename)
            msg = (f'<div class="msg ok">✅ {detail}</div>' if ok
                   else f'<div class="msg err">{detail}</div>')
            self._send_html(render_restore_page(msg))
            return
        if self.path == "/backup/restore-upload":
            content_type = self.headers.get("Content-Type", "")
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            filename, data = parse_multipart_file(body, content_type)
            if not filename or not data:
                self._send_html(render_restore_page(
                    '<div class="msg err">Keine Datei hochgeladen oder Datei nicht lesbar.</div>'))
                return
            ok, detail = restore_backup_from_bytes(data, filename)
            msg = (f'<div class="msg ok">✅ {detail}</div>' if ok
                   else f'<div class="msg err">{detail}</div>')
            self._send_html(render_restore_page(msg))
            return
        if self.path == "/backup/settings":
            length = int(self.headers.get("Content-Length", 0))
            fields = parse_qs(self.rfile.read(length).decode("utf-8"))
            schedule = fields.get("schedule", [""])[0]
            max_backups = fields.get("max_backups", [""])[0]
            ok, detail = set_backup_settings(schedule, max_backups)
            msg = (f'<div class="msg ok">✅ {detail}</div>' if ok
                   else f'<div class="msg err">{detail}</div>')
            self._send_html(render_backup_page(msg))
            return
        if self.path == "/backup/usb/format":
            length = int(self.headers.get("Content-Length", 0))
            fields = parse_qs(self.rfile.read(length).decode("utf-8"))
            device = fields.get("device", [""])[0]
            FORMAT_STATE.update(done=False, ok=None, detail=None)
            threading.Thread(target=_run_format_in_background, args=(device,), daemon=True).start()
            self._send_json({"started": True})
            return
        if self.path == "/backup/usb/mount":
            length = int(self.headers.get("Content-Length", 0))
            fields = parse_qs(self.rfile.read(length).decode("utf-8"))
            device = fields.get("device", [""])[0]
            ok, detail = mount_existing_usb(device)
            msg = (f'<div class="msg ok">✅ {detail}</div>' if ok
                   else f'<div class="msg err">{detail}</div>')
            self._send_html(render_backup_page(msg))
            return
        if self.path == "/backup/usb/eject":
            ok, detail = eject_usb()
            msg = ('<div class="msg ok">✅ USB-Stick sicher entfernt.</div>' if ok
                   else f'<div class="msg err">Aushängen fehlgeschlagen: {detail}</div>')
            self._send_html(render_backup_page(msg, skip_remount=ok))
            return
        if self.path == "/update/run":
            UPDATE_STATE.update(done=False, ok=None, detail=None)
            threading.Thread(target=_run_update_in_background, daemon=True).start()
            self._send_json({"started": True})
            return
        self.send_response(404)
        self.end_headers()


class WifiHandler(BaseHandler):
    def do_GET(self):
        if self.path == "/logo.png":
            self.serve_logo()
            return
        if self.path == "/status":
            self._send_json(CONN_STATE)
            return
        self._send_html(render_form())

    def do_POST(self):
        if self.path == "/disconnect":
            ok, detail = disconnect_wifi()
            if ok:
                self._send_html(render_form('<div class="msg ok">🔌 WLAN getrennt.</div>'))
            else:
                self._send_html(render_form(f'<div class="msg err">Trennen fehlgeschlagen: {detail}</div>'))
            return
        if self.path != "/connect":
            self.send_response(404)
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length", 0))
        fields = parse_qs(self.rfile.read(length).decode("utf-8"))
        ssid = (fields.get("ssid_manual", [""])[0] or fields.get("ssid", [""])[0]).strip()
        password = fields.get("password", [""])[0]
        if not ssid:
            self._send_html(render_form('<div class="msg err">Bitte eine SSID auswaehlen oder eingeben.</div>'))
            return
        CONN_STATE.update(done=False, ok=None, detail=None)
        self._send_html(PAGE_CONNECTING.format(ssid=ssid, app_url=app_url()))
        ok, detail = connect_wifi(ssid, password)
        CONN_STATE.update(done=True, ok=ok, detail=None if ok else detail)
        if ok:
            print(f"WLAN-Verbindung zu '{ssid}' erfolgreich.", file=sys.stderr)
        else:
            print(f"WLAN-Verbindung zu '{ssid}' fehlgeschlagen: {detail}", file=sys.stderr)
        # Server laeuft in jedem Fall weiter - dauerhaftes Einstellungen-Portal,
        # nicht nur fuer die Ersteinrichtung.


def main():
    wifi_server = ThreadingHTTPServer((HOST, PORT_WIFI), WifiHandler)
    landing_server = ThreadingHTTPServer((HOST, PORT_LANDING), LandingHandler)
    threading.Thread(target=wifi_server.serve_forever, daemon=True).start()
    print(f"WLAN-Einstellungen laufen dauerhaft auf {HOST}:{PORT_WIFI}", file=sys.stderr)
    print(f"Setup-Seite laeuft dauerhaft auf {HOST}:{PORT_LANDING}", file=sys.stderr)
    landing_server.serve_forever()


if __name__ == "__main__":
    if "--check-update" in sys.argv:
        # Wird per systemd-Timer regelmaessig (nicht dauerhaft laufend)
        # aufgerufen, um den Update-Zwischenspeicher fuer die Startseite
        # aktuell zu halten, ohne bei jedem Seitenaufruf GitHub kontaktieren
        # zu muessen.
        run_update_check_once()
    else:
        main()
