# Bereitstellung auf einem Raspberry Pi

> ⚠️ Die WLAN-Einrichtung, Hostname-Änderung und der Boot-Bildschirm in
> diesem Dokument sind Raspberry-Pi-spezifisch. `install.sh` erkennt
> automatisch, ob es auf einem echten Pi läuft, und überspringt diese
> Schritte auf einem normalen Debian-/Linux-Server – Backup, Update und
> die Setup-Seite selbst funktionieren dort identisch. Details zur
> Linux-Server-Nutzung: [README.md](../README.md).

Alternativ zum Debian-LXC-Container lässt sich die App auch direkt auf
einem Raspberry Pi betreiben – inklusive WLAN-Ersteinrichtung per
Netzwerkkabel (Kabel anschließen, Formular im Browser ausfüllen, Kabel
wieder entfernen), automatischen täglichen Backups und einer eingebauten
Update-Funktion. Alle dafür nötigen Dateien liegen im Ordner `setup/`
(Alles-in-einem-Paket).

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

1. Den kompletten `setup`-Ordner auf den frisch installierten Pi kopieren,
   z. B. nach `/opt/setup`.
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

Wurde stattdessen der komplette Projekt-Ordner kopiert (nicht nur
`setup/`), findet sich im Hauptordner zusätzlich ein `install.sh`, das nur
an `setup/install.sh` weiterleitet – man muss also nicht erst nach
`setup/` wechseln, um loszulegen:

```bash
sudo bash install.sh
```

**Wichtig:** immer mit `sudo bash install.sh` (bzw.
`sudo bash setup/install.sh`) starten, nicht mit `sudo ./install.sh`.
Manche Kopierwege – z. B. ein FAT32/exFAT-formatierter USB-Stick – können
grundsätzlich keine Unix-Ausführungsrechte speichern, das Skript kommt
dann ohne `+x` an und `./install.sh` scheitert mit „Permission denied“.
Der Aufruf per `bash install.sh` braucht dagegen nur Leserecht und
funktioniert immer, unabhängig vom Kopierweg. Fehlt das Ausführungsrecht
trotzdem einmal störend (z. B. für ein eigenes Skript), hilft einmalig
`chmod +x install.sh`.

## Was das Skript macht

- WLAN-Modul vorbereiten (`rfkill unblock wifi`, `nmcli radio wifi on`,
  deaktiviert einen konkurrierenden `wpa_supplicant.service` falls aktiv)
- `/opt/imkerei` einrichten: Code + `data/`, Dienst-Benutzer `imkerei`,
  Rechte setzen
- `imkerei.service` installieren und starten (App-Autostart, Neustart bei
  Absturz) – BeeTown läuft auf **Port 8080**
- `/opt/setup-portal` einrichten: dauerhaftes, **App-übergreifendes**
  Setup-Portal auf **Port 80** (Links zur/den installierten App(s),
  aktuelle IPs, Neustart/Herunterfahren). Läuft auch das Schwesterprojekt
  HonigBox auf demselben Pi, teilen sich beide dieses eine Portal – jede
  App registriert sich dort nur mit einer kleinen Beschreibung
  (`/opt/setup-portal/apps.d/imkerei.json`), ohne die andere App
  anzufassen. WLAN-Einstellungen (einrichten/wechseln/trennen) sind eine
  Unterseite davon (`/wifi`), nur auf einem echten Raspberry Pi
  sichtbar/erreichbar. Dauerhaft erreichbar, egal ob WLAN verbunden ist
  oder nicht
- `/opt/backup-scripts` einrichten: tägliches Backup nach `/opt/backup`
  (03:30 Uhr, max. 20 Archive)
- Update-Check einrichten: prüft täglich (04:00 Uhr) im Hintergrund gegen
  das öffentliche GitHub-Repo, ob eine neuere Version vorliegt – Ergebnis
  erscheint als Badge auf der Startseite, der eigentliche Update-Vorgang
  läuft über den „🔄 Update“-Button dort (siehe unten)
- `/etc/issue` mit einem Boot-Bildschirm beschreiben: zeigt beim Anschluss
  eines Monitors direkt die Adressen von Setup-Seite und BeeTown (und
  ggf. HonigBox) sowie die aktuellen IP-Adressen (Kabel/WLAN) an
- Ordnet Code-Ordner (außer `data/`) dem aufrufenden SSH-Benutzer zu, damit
  künftige Datei-Updates per FTP/SFTP ohne Berechtigungsprobleme klappen
- Hostname fest auf `beetown` setzen + Neustart (nur beim allerersten Lauf,
  solange der Pi noch den Werksnamen `raspberrypi` trägt – läuft HonigBox
  bereits auf demselben Pi und hat den Hostnamen schon geändert, bleibt er
  unangetastet)

## Ports im Überblick

| Port | Seite |
|---|---|
| 80 (Ausweich-Port 8082, falls 80 schon belegt) | Setup-/Startseite inkl. WLAN-Einstellungen unter `/wifi` (nur Pi): Links, IP-Adressen, Neustart/Herunterfahren |
| 8080 (Ausweich-Port 8083, falls 8080 schon belegt) | BeeTown (die eigentliche App) |

`install.sh` prüft beim Einrichten automatisch, ob die Standard-Ports
schon belegt sind, und weicht bei Bedarf aus – wird im Terminal
angezeigt.

## Enthaltene Dateien (Ordner `setup/`)

| Datei | Zweck |
|---|---|
| `install.sh` | Installationsskript (dieses hier ausführen) |
| `server.py`, `static/` | Die BeeTown-App selbst (Symlinks auf die Dateien im Hauptordner, siehe unten) |
| `imkerei.service` | systemd-Unit für die App |
| `imkerei-backup.sh`, `imkerei-backup.service`, `imkerei-backup.timer` | Tägliches Backup |
| `imkerei-update-check.service`, `imkerei-update-check.timer` | Täglicher Update-Check gegen GitHub (Badge auf der Startseite) |
| `hilfe-bilder/` | Optionale eigene VPN-Screenshots (siehe `hilfe-bilder/LIESMICH.txt`) |
| `data/logo.jpg` | Standard-Betriebslogo, wird bei der Ersteinrichtung nach `/opt/imkerei/data/logo.jpg` übernommen (nur falls dort noch keins existiert – ein später über die App-Einstellungen hochgeladenes Logo bleibt bei erneuten Läufen erhalten) |

Das gemeinsame, App-übergreifende Setup-Portal (WLAN, Backup, Update,
Hilfe unter Port 80) ist **nicht** Teil dieses Repos, sondern das
eigenständige Projekt [Chrischn73/setup-portal](https://github.com/Chrischn73/setup-portal).
`install.sh` lädt es nur bei Bedarf einmalig automatisch herunter (falls
`/opt/setup-portal` noch nicht existiert – z. B. weil HonigBox es auf
demselben Pi schon eingerichtet hat, dann übernimmt `install.sh` hier
einfach die vorhandene Installation). Danach aktualisiert sich das Portal
über einen eigenen täglichen Timer selbst – kein erneuter `install.sh`-Lauf
nötig, um eine neue Portal-Version zu bekommen.

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

## `setup/`-Ordner: Symlinks statt Kopien

`setup/server.py` und `setup/static` sind Symlinks auf die Dateien im
Hauptprojekt-Ordner (`../server.py`, `../static`) – Änderungen daran sind
also automatisch auch dort sichtbar, ein manuelles Nachkopieren entfällt.
Ebenso ist `setup/README.md` ein Symlink auf diese Datei hier.

Wichtig beim Kopieren des `setup/`-Ordners auf einen USB-Stick/FTP-Ziel:
normales `cp -r` kopiert Symlinks als Symlink (auf dem Stick dann
ungültig, da der übergeordnete Projektordner dort fehlt). Immer mit
aufgelösten Symlinks kopieren, z. B.:

```bash
cp -rL setup /pfad/zum/stick/setup
```

`zip -r` löst Symlinks standardmäßig automatisch auf (kein `-L` nötig).
`install.sh` selbst kopiert `static/` beim Installieren ebenfalls mit
`cp -rL`, als zusätzliche Absicherung falls doch mal ein Symlink
mitkopiert wurde.

`install.sh` sucht `server.py`/`static` zuerst im Projekt-Wurzelordner
(Layout: kompletter Projekt-Ordner übertragen) und fällt erst danach auf
`setup/` selbst zurück (Layout: nur `setup/` mit aufgelösten Symlinks
übertragen) – beide oben beschriebenen Vorgehen funktionieren also, ohne
dass man vorher wissen muss, welches man gerade verwendet. Fehlen die
Dateien in BEIDEN Orten (z. B. weil eine SFTP-GUI die Symlinks beim
Übertragen des kompletten Projekt-Ordners weder auflöst noch mitkopiert),
bricht das Skript mit einer klaren Fehlermeldung ab, statt mit einem
kryptischen `cp: fehlt` irgendwo mitten in der Installation zu scheitern.
