"""Backup/Restore und Migration. Der wichtigste Test hier ist
test_restore_uebernimmt_jede_spalte: Er fuellt JEDE Spalte JEDER Tabelle
(laut Datenbank, nicht laut Code) und prueft, dass Export + Import sie
unveraendert zurueckbringen. Vergisst man eine neue Spalte im Restore,
schlaegt er fehl, statt dass die Daten still verschwinden."""
import io
import json
import os
import sqlite3
import zipfile

import pytest

# Spalten, die im Export als JSON geparst und beim Import wieder serialisiert werden
JSON_WERTE = {
    ("entries", "photos"): [{"id": "p1", "caption": "c"}],
    ("entries", "obs"): ["queen_seen"],
    ("entries", "obs_extra"): {"k": "v"},
    ("honey_stir_entries", "photos"): [{"id": "p2", "caption": ""}],
    ("honey_sales", "items"): [{"productId": "x", "qty": 2}],
    ("honey_products", "giftSetProductIds"): ["a", "b"],
    ("reminders", "repeatWeekdays"): [1, 3],
    ("reminders", "autoRefs"): [{"colonyId": "c1", "name": "1", "stage": 2}],
}


def _tabellen(con):
    return [r[0] for r in con.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]


def _spalten(con, tabelle):
    return [(r[1], (r[2] or "").upper()) for r in con.execute(f"PRAGMA table_info({tabelle})")]


def _fuelle_alle_spalten(con):
    """Je Tabelle zwei Zeilen, jede Spalte mit einem eindeutigen Wert."""
    erwartet = {}
    for t in _tabellen(con):
        con.execute(f"DELETE FROM {t}")
        zeilen = []
        for n in range(2):
            zeile = {}
            for i, (name, typ) in enumerate(_spalten(con, t)):
                if (t, name) == ("entries", "photoIds"):
                    wert = None  # Altspalte: Restore wandelt sie in "photos" um
                elif (t, name) in JSON_WERTE:
                    wert = json.dumps(JSON_WERTE[(t, name)])
                elif (t, name) == ("honey_products", "active"):
                    wert = n  # wird beim Restore auf 0/1 normalisiert
                elif name in ("id", "key"):
                    wert = f"{t[:6]}{n}"
                elif typ == "INTEGER":
                    wert = 10 * n + i + 1
                elif typ == "REAL":
                    wert = n + i + 0.5
                else:
                    wert = f"{t}.{name}.{n}"
                zeile[name] = wert
            con.execute(f"INSERT INTO {t}({','.join(zeile)}) VALUES({','.join('?' * len(zeile))})",
                        list(zeile.values()))
            zeilen.append(zeile)
        erwartet[t] = zeilen
    con.commit()
    return erwartet


def _dump(con):
    con.row_factory = sqlite3.Row
    return {t: sorted((dict(r) for r in con.execute(f"SELECT * FROM {t}")),
                      key=lambda d: d.get("id") or d.get("key"))
            for t in _tabellen(con)}


def test_restore_uebernimmt_jede_spalte(app, request):
    con = app.db()
    _fuelle_alle_spalten(con)
    vorher = _dump(con)
    con.close()
    export = app.request("GET", "/api/backup")[1]
    ziel = request.getfixturevalue("zweite_app")
    ziel.json("POST", "/api/restore", raw=export)
    con = ziel.db()
    nachher = _dump(con)
    con.close()
    # _lastBackupAt schreibt der Export selbst dazu
    nachher["settings"] = [s for s in nachher["settings"] if s["key"] != "_lastBackupAt"]
    vorher["settings"] = [s for s in vorher["settings"] if s["key"] != "_lastBackupAt"]
    assert set(nachher) == set(vorher)
    for t in vorher:
        assert nachher[t] == vorher[t], f"Tabelle {t} nach Restore verändert"


def test_zip_backup_mit_fotos_und_restore(app, request):
    aid = app.post("/api/apiaries", {"name": "A"})["id"]
    cid = app.post("/api/colonies", {"apiaryId": aid, "name": "1"})["id"]
    pid = app.json("POST", "/api/photos", raw=b"\xff\xd8JPEG", content_type="image/jpeg")["id"]
    app.post("/api/entries", {"colonyId": cid, "photos": [{"id": pid, "caption": "c"}]})
    with open(os.path.join(app.server.PHOTO_DIR, "fremd.txt"), "w") as f:
        f.write("x")
    status, daten, kopf = app.request("GET", "/api/backup?format=zip")
    assert status == 200 and kopf["Content-Type"] == "application/zip"
    namen = zipfile.ZipFile(io.BytesIO(daten)).namelist()
    assert "backup.json" in namen and f"photos/{pid}.jpg" in namen
    assert not any("fremd" in n for n in namen)

    ziel = request.getfixturevalue("zweite_app")
    ziel.json("POST", "/api/restore", raw=daten, content_type="application/zip")
    with open(os.path.join(ziel.datadir, "photos", pid + ".jpg"), "rb") as f:
        assert f.read() == b"\xff\xd8JPEG"
    assert ziel.get(f"/api/colonies/{cid}")["name"] == "1"


def test_zip_restore_ignoriert_pfad_tricks(app):
    puffer = io.BytesIO()
    with zipfile.ZipFile(puffer, "w") as z:
        z.writestr("backup.json", json.dumps({"app": "imkerei"}))
        z.writestr("photos/../../boese.jpg", "x")
        z.writestr("../boese2.jpg", "x")
    app.json("POST", "/api/restore", raw=puffer.getvalue(), content_type="application/zip")
    oben = os.path.dirname(app.datadir)
    for name in ("boese.jpg", "boese2.jpg"):
        assert not os.path.exists(os.path.join(app.datadir, name))
        assert not os.path.exists(os.path.join(oben, name))


@pytest.mark.parametrize("daten,ct", [
    (b"keinzip", "application/zip"),
    (b'{"app":"fremd"}', "application/json"),
])
def test_ungueltiges_backup_400(app, daten, ct):
    assert app.request("POST", "/api/restore", raw=daten, content_type=ct)[0] == 400


def test_fehlgeschlagener_restore_laesst_daten_stehen(app):
    app.post("/api/apiaries", {"name": "bleibt"})
    # Standort ohne id -> KeyError mitten im Restore -> alles zurueckrollen
    status, _, _ = app.request("POST", "/api/restore",
                               {"app": "imkerei", "apiaries": [{"name": "kaputt"}]})
    assert status == 400
    assert [a["name"] for a in app.get("/api/apiaries")] == ["bleibt"]


def test_alte_json_backups_mit_photoids(app):
    backup = {"app": "imkerei",
              "colonies": [{"id": "c1", "apiaryId": "a1", "name": "1"}],
              "entries": [{"id": "e1", "colonyId": "c1", "photoIds": ["p1", "p2"]}]}
    app.post("/api/restore", backup)
    e = app.get("/api/entries?colonyId=c1")[0]
    assert [p["id"] for p in e["photos"]] == ["p1", "p2"]


def test_migration_ergaenzt_fehlende_spalten(app, tmp_path):
    """Eine Datenbank im Stil einer sehr alten Version (nur Grundspalten)
    muss nach init_db() dieselben Spalten haben wie eine neu angelegte."""
    con = app.db()
    soll = {t: {n for n, _ in _spalten(con, t)} for t in _tabellen(con)}
    con.close()

    alt = tmp_path / "alt.db"
    c = sqlite3.connect(alt)
    c.executescript("""
        CREATE TABLE apiaries(id TEXT PRIMARY KEY, name TEXT);
        CREATE TABLE colonies(id TEXT PRIMARY KEY, apiaryId TEXT, name TEXT, status TEXT, createdAt TEXT);
        CREATE TABLE entries(id TEXT PRIMARY KEY, colonyId TEXT, date TEXT, type TEXT, notes TEXT,
                             photoIds TEXT, createdAt TEXT);
        CREATE TABLE reminders(id TEXT PRIMARY KEY, text TEXT, createdAt TEXT);
        CREATE TABLE honey_products(id TEXT PRIMARY KEY, name TEXT, price REAL, sizeGrams INTEGER,
                                    active INTEGER, sortOrder INTEGER, createdAt TEXT);
        CREATE TABLE honey_sales(id TEXT PRIMARY KEY, date TEXT, items TEXT, total REAL, createdAt TEXT);
        INSERT INTO entries(id,colonyId,photoIds,createdAt) VALUES('e1','c1','["p1"]','2020');
        INSERT INTO honey_sales(id,date,items,total,createdAt) VALUES('s1','2020','[]',1,'2020-01-01');
    """)
    c.commit()
    c.close()
    app.server.DB_PATH = str(alt)
    app.server.init_db()
    con = app.db()
    for t, spalten in soll.items():
        ist = {n for n, _ in _spalten(con, t)}
        assert spalten <= ist, f"{t}: fehlt {spalten - ist}"
    # Altdaten-Nacharbeiten
    assert json.loads(con.execute("SELECT photos FROM entries WHERE id='e1'").fetchone()[0]) == \
        [{"id": "p1", "caption": ""}]
    assert con.execute("SELECT updatedAt FROM honey_sales WHERE id='s1'").fetchone()[0] == "2020-01-01"
    con.close()
