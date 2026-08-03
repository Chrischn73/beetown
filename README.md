# BeeTown – digitale Stockkarte (selbst gehostet)

Kleine Web-App (PWA) zur Imkereiverwaltung: Standorte, Völker, Stockkarten-Einträge mit Fotos. Beide Handys greifen über das VPN auf **denselben** Server zu.

- **Backend:** ein Python-Skript (`server.py`), nur Standardbibliothek, SQLite. Kein pip, kein Framework.

- **Frontend:** statische PWA im Ordner `static/`.

- **Daten:** zentral auf dem Server unter `data/` (`app.db` + `photos/`).


## Bereitstellung auf einem Raspberry Pi

Alternativ zum Debian-LXC-Container (unten) lässt sich die App auch direkt
auf einem Raspberry Pi betreiben – inklusive WLAN-Ersteinrichtung per
Netzwerkkabel (Kabel anschließen, Formular im Browser ausfüllen, Kabel
wieder entfernen), automatischen täglichen Backups und einer eingebauten
Update-Funktion. Alle dafür nötigen Dateien liegen im Ordner `setup/`
(Alles-in-einem-Paket).

### Nutzung

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

### Was das Skript macht

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

### Ports im Überblick

| Port | Seite |
|---|---|
| 80   | Setup-/Startseite: Links, IP-Adressen, Neustart/Herunterfahren |
| 8080 | BeeTown (die eigentliche App) |
| 8081 | WLAN-Einstellungen (einrichten/wechseln/trennen) |

### Enthaltene Dateien (Ordner `setup/`)

| Datei | Zweck |
|---|---|
| `install.sh` | Installationsskript (dieses hier ausführen) |
| `server.py`, `static/` | Die BeeTown-App selbst (Symlinks auf die Dateien im Hauptordner, siehe unten) |
| `imkerei.service` | systemd-Unit für die App |
| `imkerei_wifi_portal.py`, `imkerei-wifi-setup.sh`, `imkerei-wifi-setup.service` | Setup-Seite (80) + WLAN-Einstellungen (8081) |
| `imkerei-backup.sh`, `imkerei-backup.service`, `imkerei-backup.timer` | Tägliches Backup |
| `imkerei-update-check.service`, `imkerei-update-check.timer` | Täglicher Update-Check gegen GitHub (Badge auf der Startseite) |
| `data/logo.jpg` | Standard-Betriebslogo, wird bei der Ersteinrichtung nach `/opt/imkerei/data/logo.jpg` übernommen (nur falls dort noch keins existiert – ein später über die App-Einstellungen hochgeladenes Logo bleibt bei erneuten Läufen erhalten) |

### Update-Funktion

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

### `setup/`-Ordner: Symlinks statt Kopien

`setup/server.py` und `setup/static` sind Symlinks auf die Dateien im
Hauptprojekt-Ordner (`../server.py`, `../static`) – Änderungen daran sind
also automatisch auch dort sichtbar, ein manuelles Nachkopieren entfällt.
Ebenso ist `setup/README.md` ein Symlink auf diese Datei hier – es soll
nur eine README im Projekt geben.

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


## Bereitstellung auf einem allgemeinen Linux Server

## 1. Debian-13-Container (LXC) in Proxmox

In Proxmox einen unprivilegierten LXC mit Debian 13 erstellen, starten, hineinverbinden. Python 3 ist auf Debian 13 vorinstalliert – nichts weiter nötig:

```bash
apt update && apt -y upgrade
python3 --version        # sollte 3.x zeigen
```

## 2. App ablegen

Inhalt dieses Archivs nach `/opt/imkerei` kopieren (z. B. per `scp` oder Proxmox-Push):

```bash
mkdir -p /opt/imkerei
# server.py, static/, data/ nach /opt/imkerei kopieren
```

Dienst-Benutzer anlegen und Rechte setzen:

```bash
useradd --system --home /opt/imkerei --shell /usr/sbin/nologin imkerei
chown -R imkerei:imkerei /opt/imkerei
chmod -R u+rwX /opt/imkerei/data
```

## 3. Als Dienst starten (systemd)

```bash
cp /opt/imkerei/imkerei.service /etc/systemd/system/imkerei.service
systemctl daemon-reload
systemctl enable --now imkerei
systemctl status imkerei        # aktiv?
```

Der Server lauscht jetzt auf Port **8080**. Test vom Container aus:

```bash
curl -s localhost:8080/api/apiaries     # -> []
```

## 4. Aufrufen

Über das VPN im Browser des Handys öffnen:

```
http://<container-ip>:8080
```

Fertig – Standorte/Völker/Einträge anlegen. Beide Handys sehen denselben Stand.


## Aktualisieren

`server.py` bzw. `static/` ersetzen und `systemctl restart imkerei`. Der Ordner `data/` bleibt unangetastet.


## Funktionsumfang

- Logo „Imkerei Frerichs" auf der Hauptseite

- **Hell-/Dunkel-Modus** (System/Hell/Dunkel, umschaltbar unter Einstellungen)

- Standorte anlegen/bearbeiten/löschen (Anlegen unter **Einstellungen**)

- Völker je Standort; Königin-Jahr als Auswahl der **letzten 4 Jahre inkl. Farbe**, Anzeige als Zahl mit **farbigem Hintergrund** (weiß/gelb/rot/grün/blau)

- Stockkarten-Einträge je Volk (Art, Datum, Notizen)

- **Beobachtungs-Buttons** im Eintrag: Königin · Stifte · Larven/Maden · offene Schwarmzelle · verdeckelte Schwarmzelle · Löchriges Brutnest. Zusätzlich drei Auswahl-Buttons, die beim Antippen ein Auswahlfenster mit festen Stufen öffnen (Button-Text zeigt danach die gewählte Stufe): **Schwarmstimmung** (Starke SS · Normale SS · Geringe SS · Keine SS), **Wildbau** (Gering · Mittel · Stark) und **Anzahl Waben** (1–12)

- **Sanftmut**: Skala 1–5, dabei 5 = sehr sanft und 1 = stechlustig

- **Volksstärke**: Skala 1–5 (Zahl-Wort-Zuordnung unverändert, 1 = sehr schwach … 5 = sehr stark), in der Liste absteigend von 5 nach 1 sortiert

- **Futter**: ebenfalls mit vorangestellter Zahl (5 – Zu viel · 4 – Gut · 3 – Mittel · 2 – Gering · 1 – Nichts)

- **+Wabe**: Wabentyp je Position (1–12) dokumentieren, dabei je Position per Häkchen unterscheiden, ob eine vorhandene Wabe **ausgetauscht** oder eine neue **hinzugefügt** wurde (in der Übersicht vorne statt „+" als farbiges, vergrößertes ⇄ markiert)

- **Sammeleintrag**: ein Eintrag für mehrere ausgewählte Völker eines Stands

- Fotos aus **Kamera oder Galerie**, je Foto eine **optionale Beschreibung**; auf dem Handy verkleinert, zentral gespeichert. Beim Löschen eines Eintrags/Volks/ Standorts werden die zugehörigen Bilddateien auf dem Server mitgelöscht

- **Archiv**: Völker archivieren und – mit Wahl des Ziel-Standorts – wiederherstellen; im Archiv nach Jahr sortiert. Archivierte Völker bleiben erhalten, auch wenn ihr ursprünglicher Standort gelöscht wird. Ein archiviertes Volk lässt sich aus dem Archiv heraus öffnen und schreibgeschützt einsehen (Stockkarte, alle Einträge inkl. Varroa-Zählungen und Fotos – keine Bearbeitung möglich). Beim Verschieben ins Archiv wird der Volksname automatisch mit „Archiv-" markiert (nur einmalig, kein doppeltes Präfix bei erneutem Archivieren/Wiederherstellen); bei der Wiederherstellung bleiben sämtliche Daten des Volks erhalten. Im Archiv kann ein Volk auch endgültig gelöscht werden (inkl. aller Einträge und Fotos)

- **Oxalsäure-Blockbehandlung**: je gespeicherter Stufe wird automatisch eine Erinnerung für die nächste fällige Stufe angelegt (Tage zwischen den Stufen einstellbar, Standard 4). Völker desselben Standorts mit gleichem Fälligkeitsdatum landen dabei in **einer gemeinsamen Erinnerung** (je Volk eine Zeile) statt in Dubletten; bei der letzten Stufe entfällt die Erinnerung wieder

- **„BK"-Sonderbehandlung**: Völker/Standorte, deren Name mit einem einstellbaren Präfix beginnt (Standard „BK"), werden in Übersichten (Alle Völker, Gewicht, Varroa-Zählung, Varroa-Historie, Ziel-Gewicht setzen) gesondert behandelt bzw. ausgeblendet. Präfix unter **Einstellungen** änderbar, leer lassen deaktiviert die Sonderbehandlung

- Backup/Restore (JSON)


