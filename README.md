# BeeTown – digitale Stockkarte (selbst gehostet)

Kleine Web-App (PWA) zur Imkereiverwaltung: Standorte, Völker, Stockkarten-Einträge mit Fotos. Beide Handys greifen über das VPN auf **denselben** Server zu.

- **Backend:** ein Python-Skript (`server.py`), nur Standardbibliothek, SQLite. Kein pip, kein Framework.

- **Frontend:** statische PWA im Ordner `static/`.

- **Daten:** zentral auf dem Server unter `data/` (`app.db` + `photos/`).


## Bereitstellung auf einem Raspberry Pi

Alternativ zum Debian-LXC-Container (oben) lässt sich die App auch direkt auf einem Raspberry Pi betreiben – inklusive WLAN-Ersteinrichtung per Netzwerkkabel (Kabel anschließen, Formular im Browser ausfüllen, Kabel wieder entfernen) und automatischen täglichen Backups.

- **Alles-in-einem-Paket:** [setup/](setup/README.md) – kompletten Ordner per FTP auf den Pi kopieren, `sudo bash install.sh` ausführen, fertig.


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


