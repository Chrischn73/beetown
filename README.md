# BeeTown – digitale Stockkarte (selbst gehostet)

## Was benötige ich, um die App zu betreiben?

Eine von zwei Optionen:

1. einen **Raspberry Pi**
2. einen **Linux-Server**

Beide sollten nur im **lokalen Netz** betrieben werden, da die App keine
Benutzer-/Passwort-Abfrage bietet.

Kleine Web-App (PWA) zur Imkereiverwaltung: Standorte, Völker, Stockkarten-Einträge mit Fotos. Beide Handys greifen über das VPN auf **denselben** Server zu.

- **Backend:** ein Python-Skript (`server.py`), nur Standardbibliothek, SQLite. Kein pip, kein Framework.

- **Frontend:** statische PWA im Ordner `static/`.

- **Daten:** zentral auf dem Server unter `data/` (`app.db` + `photos/`).


## Bereitstellung auf einem Raspberry Pi

Alternativ zu einem Linux-Server (unten) lässt sich die App auch direkt
auf einem Raspberry Pi betreiben – inklusive WLAN-Ersteinrichtung per
Netzwerkkabel, automatischen täglichen Backups und einer eingebauten
Update-Funktion. Alle dafür nötigen Dateien liegen im Ordner `setup/`.

⚠️ Nur für Raspberry Pi OS (Lite/Core) – Details, Installationsschritte
und Hintergründe: **[docs/raspberry-pi.md](docs/raspberry-pi.md)**.


## Bereitstellung auf einem allgemeinen Linux Server

`install.sh` richtet BeeTown seit Kurzem auch auf einem normalen
Debian-/Linux-Server ein – mit denselben Funktionen wie auf dem
Raspberry Pi (automatische tägliche Backups, Update-Funktion,
Setup-Seite), nur ohne WLAN-Einrichtung, Hostname-Änderung und
automatischen Neustart, die auf einem Server nicht gebraucht werden.

Nutzung identisch zum Raspberry Pi (siehe oben) – derselbe `setup/`-
Ordner, dieselben Download-Optionen A/B. Details:
**[docs/raspberry-pi.md](docs/raspberry-pi.md)**.


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


