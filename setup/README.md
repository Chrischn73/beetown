# Setup-Paket für Raspberry Pi (Alles-in-einem)

Dieser Ordner enthält alle Dateien, die für eine komplette Ersteinrichtung
auf einem frisch installierten Raspberry Pi OS Lite (Core) nötig sind –
inklusive Installationsskript. Kein separates Nachladen aus anderen
Ordnern nötig.

## Nutzung

**Option A: direkt per SSH-Konsole von GitHub laden** (kein FTP-Programm
nötig, nur eine bestehende SSH-Verbindung z. B. per Netzwerkkabel):

```bash
curl -L https://github.com/Chrischn73/beetown/archive/refs/heads/main.tar.gz -o beetown.tar.gz
tar xzf beetown.tar.gz
cd beetown-main/setup
sudo bash install.sh
```

**Option B: per FTP/SFTP/FileZilla**

1. Diesen kompletten `setup`-Ordner auf den frisch installierten Pi
   kopieren, z. B. nach `/opt/setup`.
2. Per SSH verbinden und ausführen:

   ```bash
   sudo bash /opt/setup/install.sh
   ```

Der Hostname wird dabei fest auf **`beetown`** gesetzt, am Ende startet
der Pi automatisch neu (dafür nötig). Das Skript ist mehrfach ausführbar –
nach einem Update der Dateien in diesem Ordner (Option B) bzw. einem
erneuten Download (Option A) einfach erneut laufen lassen, um die
Installation zu aktualisieren. Für spätere Updates reicht ohnehin der
„🔄 Update“-Button auf der Startseite (siehe unten) – `install.sh` muss
danach nur noch laufen, wenn sich an den systemd-Units selbst etwas
ändert.

## Was das Skript macht

- WLAN-Modul vorbereiten (`rfkill unblock wifi`, `nmcli radio wifi on`,
  deaktiviert einen konkurrierenden `wpa_supplicant.service` falls aktiv)
- `/opt/imkerei` einrichten: Code + `data/`, Dienst-Benutzer `imkerei`,
  Rechte setzen
- `imkerei.service` installieren und starten (App-Autostart, Neustart bei
  Absturz) – BeeTown läuft auf **Port 8080**
- `/opt/imkerei-wifi-setup` einrichten: dauerhaftes Portal mit zwei Seiten
  im selben Prozess – Setup-/Startseite auf **Port 80** (Links zu BeeTown
  und WLAN-Einstellungen, aktuelle IPs, Neustart/Herunterfahren) und
  WLAN-Einstellungen auf **Port 8081** (einrichten/wechseln/trennen,
  ebenfalls mit Neustart/Herunterfahren). Beide dauerhaft erreichbar, egal
  ob WLAN verbunden ist oder nicht
- `/opt/backup-scripts` einrichten: tägliches Backup nach `/opt/backup`
  (03:30 Uhr, max. 20 Archive)
- Update-Check einrichten: prüft täglich (04:00 Uhr) im Hintergrund gegen
  das öffentliche GitHub-Repo, ob eine neuere Version vorliegt – Ergebnis
  erscheint als Badge auf der Startseite, der eigentliche Update-Vorgang
  läuft über den „🔄 Update“-Button dort (siehe unten)
- `/etc/issue` mit einem Boot-Bildschirm beschreiben: zeigt beim Anschluss
  eines Monitors direkt die Adressen von Setup-Seite, BeeTown und
  WLAN-Einstellungen sowie die aktuellen IP-Adressen (Kabel/WLAN) an
- Ordnet Code-Ordner (außer `data/`) dem aufrufenden SSH-Benutzer zu, damit
  künftige Datei-Updates per FTP/SFTP ohne Berechtigungsprobleme klappen
- Hostname fest auf `beetown` setzen + Neustart (immer, am Ende)

## Ports im Überblick

| Port | Seite |
|---|---|
| 80   | Setup-/Startseite: Links, IP-Adressen, Neustart/Herunterfahren |
| 8080 | BeeTown (die eigentliche App) |
| 8081 | WLAN-Einstellungen (einrichten/wechseln/trennen) |

## Enthaltene Dateien

| Datei | Zweck |
|---|---|
| `install.sh` | Installationsskript (dieses hier ausführen) |
| `server.py`, `static/` | Die BeeTown-App selbst |
| `imkerei.service` | systemd-Unit für die App |
| `imkerei_wifi_portal.py`, `imkerei-wifi-setup.sh`, `imkerei-wifi-setup.service` | Setup-Seite (80) + WLAN-Einstellungen (8081) |
| `imkerei-backup.sh`, `imkerei-backup.service`, `imkerei-backup.timer` | Tägliches Backup |
| `imkerei-update-check.service`, `imkerei-update-check.timer` | Täglicher Update-Check gegen GitHub (Badge auf der Startseite) |
| `data/logo.jpg` | Standard-Betriebslogo, wird bei der Ersteinrichtung nach `/opt/imkerei/data/logo.jpg` übernommen (nur falls dort noch keins existiert – ein später über die App-Einstellungen hochgeladenes Logo bleibt bei erneuten Läufen erhalten) |

## Update-Funktion

Auf der Startseite (Port 80) gibt es einen **🔄 Update**-Button (Seite
`/update`). Dort wird die installierte Version mit dem neuesten
GitHub-Release verglichen. Ist eine neuere Version vorhanden, erscheint
ein Button „Auf vX.Y.Z aktualisieren“. Beim Klick passiert automatisch:

1. Backup erstellen (Datenbank + Fotos, wie beim manuellen Backup)
2. Neueste Version von GitHub herunterladen
3. `server.py` und `static/` ersetzen (`data/` bleibt unangetastet)
4. App-Dienst neu starten

Damit das funktioniert, muss im GitHub-Repo (`Chrischn73/beetown`) für
jede neue Version:

- `APP_VERSION` in `static/app.js` erhöht werden (z. B. `'v2.8.0'`)
- ein passendes **GitHub-Release** mit demselben Tag-Namen (`v2.8.0`)
  veröffentlicht werden

Ohne veröffentlichtes Release erkennt der Pi keine neue Version, auch wenn
im Repo schon neuer Code liegt (reine Commits auf `main` reichen nicht).

## Diesen Ordner aktuell halten

`setup/server.py` und `setup/static` sind Symlinks auf die Dateien im
Hauptprojekt-Ordner (`../server.py`, `../static`) – Änderungen daran sind
also automatisch auch hier sichtbar, ein manuelles Nachkopieren entfällt.

Wichtig beim Kopieren auf einen USB-Stick/FTP-Ziel: normales `cp -r`
kopiert Symlinks als Symlink (auf dem Stick dann ungültig, da der
übergeordnete Projektordner dort fehlt). Immer mit aufgelösten Symlinks
kopieren, z. B.:

```bash
cp -rL setup /pfad/zum/stick/setup
```

`zip -r` löst Symlinks standardmäßig automatisch auf (kein `-L` nötig).
`install.sh` selbst kopiert `static/` beim Installieren ebenfalls mit
`cp -rL`, als zusätzliche Absicherung falls doch mal ein Symlink
mitkopiert wurde.
