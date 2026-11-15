"""API-Verhalten: Fehlerbehandlung, Teil-Update am Volk, Erinnerungen,
Grund-CRUD je Tabelle."""
import json


# ---------- Fehlerbehandlung (v2.9.58) ----------

def test_ungueltige_eingabe_gibt_400_json(app):
    status, daten, _ = app.request("POST", "/api/honey_harvests", {"year": "", "menge": "abc"})
    assert status == 400
    assert "error" in json.loads(daten)


def test_put_mit_null_gibt_400(app):
    hid = app.post("/api/honey_harvests", {"year": 2026, "menge": 10})["id"]
    status, _, _ = app.request("PUT", f"/api/honey_harvests/{hid}", {"year": None})
    assert status == 400


def test_kaputtes_json_gibt_400(app):
    status, _, _ = app.request("POST", "/api/apiaries", raw=b"{kaputt")
    assert status == 400


def test_unbekannter_pfad_404(app):
    status, _, _ = app.request("GET", "/api/gibtsnicht")
    assert status == 404
    status, _, _ = app.request("PUT", "/api/gibtsnicht/abc", {})
    assert status == 404


def test_ungueltige_id_400(app):
    status, _, _ = app.request("PUT", "/api/apiaries/x.y", {"name": "a"})
    assert status == 400


# ---------- Volk: nur mitgeschickte Felder aendern ----------

def _volk(app, **felder):
    aid = app.post("/api/apiaries", {"name": "Stand A"})["id"]
    cid = app.post("/api/colonies", {"apiaryId": aid, "name": "1", **felder})["id"]
    return aid, cid


def test_volk_put_aendert_nur_mitgeschickte_felder(app):
    _, cid = _volk(app, oxalBlockStage="2", zielGewicht="38", notes="x")
    app.put(f"/api/colonies/{cid}", {"name": "1a", "requeueFlag": "1"})
    c = app.get(f"/api/colonies/{cid}")
    assert c["name"] == "1a"
    assert c["requeueFlag"] == 1
    assert c["oxalBlockStage"] == "2"
    assert c["zielGewicht"] == "38"
    assert c["notes"] == "x"
    assert c["status"] == "ok"


def test_volk_put_leert_feld_mit_leerstring(app):
    _, cid = _volk(app, notes="x")
    app.put(f"/api/colonies/{cid}", {"notes": ""})
    assert app.get(f"/api/colonies/{cid}")["notes"] == ""


def test_volk_put_ignoriert_unbekannte_und_gesperrte_felder(app):
    _, cid = _volk(app)
    vorher = app.get(f"/api/colonies/{cid}")
    app.put(f"/api/colonies/{cid}", {"archived": 1, "sortOrder": 99, "createdAt": "x",
                                     "apiaryName": "egal", "gibtsnicht": 1})
    assert app.get(f"/api/colonies/{cid}") == vorher


def test_volk_neu_zielgewicht_aus_einstellung(app):
    app.post("/api/settings", {"zielGewicht": "33"})
    _, cid = _volk(app)
    assert app.get(f"/api/colonies/{cid}")["zielGewicht"] == "33"


def test_volk_neu_zielgewicht_standard_40(app):
    _, cid = _volk(app)
    assert app.get(f"/api/colonies/{cid}")["zielGewicht"] == "40"


def test_volk_archivieren_und_zurueckholen(app):
    aid, cid = _volk(app)
    app.post(f"/api/colonies/{cid}/archive")
    assert app.get(f"/api/colonies?apiaryId={aid}") == []
    archiv = app.get("/api/archive")
    assert archiv[0]["name"] == "Archiv-1" and archiv[0]["apiaryName"] == "Stand A"
    app.post(f"/api/colonies/{cid}/restore", {})
    assert app.get(f"/api/colonies?apiaryId={aid}")[0]["archived"] == 0


def test_standort_loeschen_loescht_voelker_und_eintraege(app):
    aid, cid = _volk(app)
    app.post("/api/entries", {"colonyId": cid, "date": "2026-11-15", "type": "Sonstiges"})
    app.delete(f"/api/apiaries/{aid}")
    assert app.get(f"/api/colonies/{cid}") is None
    assert app.get(f"/api/entries?colonyId={cid}") == []


# ---------- Eintraege + Fotos ----------

def test_eintrag_put_ersetzt_ganz(app):
    _, cid = _volk(app)
    eid = app.post("/api/entries", {"colonyId": cid, "date": "2026-11-15", "type": "Varroa-Zählung",
                                    "varroaCount": "12", "varroaAnts": True, "obs": ["queen_seen"],
                                    "obs_extra": {"a": 1}})["id"]
    e = app.get(f"/api/entries?colonyId={cid}")[0]
    assert e["varroaCount"] == "12" and e["varroaAnts"] == 1
    assert e["obs"] == ["queen_seen"] and e["obs_extra"] == {"a": 1}
    app.put(f"/api/entries/{eid}", {"date": "2026-11-16", "type": "Sonstiges"})
    e = app.get(f"/api/entries?colonyId={cid}")[0]
    assert e["varroaCount"] == "" and e["varroaAnts"] == 0 and e["obs"] == []


def test_foto_wird_beim_entfernen_aus_eintrag_geloescht(app):
    import os
    _, cid = _volk(app)
    pid = app.json("POST", "/api/photos", raw=b"\xff\xd8x", content_type="image/jpeg")["id"]
    pfad = os.path.join(app.server.PHOTO_DIR, pid + ".jpg")
    eid = app.post("/api/entries", {"colonyId": cid, "photos": [{"id": pid, "caption": ""}]})["id"]
    assert os.path.exists(pfad)
    app.put(f"/api/entries/{eid}", {"photos": []})
    assert not os.path.exists(pfad)


# ---------- Erinnerungen: autoRefs ----------

def test_erinnerung_put_ohne_autorefs_behaelt_sie(app):
    refs = [{"colonyId": "abc", "name": "1", "stage": 3}]
    rid = app.post("/api/reminders", {"text": "t", "autoRefs": refs})["id"]
    app.put(f"/api/reminders/{rid}", {"text": "t2"})
    r = app.get("/api/reminders")[0]
    assert r["text"] == "t2" and r["autoRefs"] == refs


def test_erinnerung_put_mit_leeren_autorefs_leert(app):
    rid = app.post("/api/reminders", {"text": "t", "autoRefs": [{"colonyId": "a"}]})["id"]
    app.put(f"/api/reminders/{rid}", {"text": "t", "autoRefs": []})
    assert app.get("/api/reminders")[0]["autoRefs"] == []


def test_erinnerung_standardwerte(app):
    app.post("/api/reminders", {"text": "t"})
    r = app.get("/api/reminders")[0]
    assert r["repeatMode"] == "none" and r["repeatWeekdays"] == [] and r["remindDaysBefore"] == 0


# ---------- Verkauf ----------

def test_produkt_neu_bekommt_naechste_sortierung(app):
    produkte = app.get("/api/honey_products")
    pid = app.post("/api/honey_products", {"name": "Met", "price": "7.5"})["id"]
    p = [x for x in app.get("/api/honey_products") if x["id"] == pid][0]
    assert p["sortOrder"] == max(x["sortOrder"] for x in produkte) + 1
    assert p["price"] == 7.5 and p["active"] == 1 and p["kind"] == "sonstige"


def test_verkauf_put_setzt_updatedat(app):
    sid = app.post("/api/honey_sales", {"date": "2026-11-15", "items": [{"q": 1}], "total": "5"})["id"]
    vorher = app.get("/api/honey_sales")[0]
    assert vorher["createdAt"] == vorher["updatedAt"] and vorher["items"] == [{"q": 1}]
    app.put(f"/api/honey_sales/{sid}", {"date": "2026-11-16", "total": 6})
    nachher = app.get("/api/honey_sales")[0]
    assert nachher["total"] == 6 and nachher["items"] == []
    assert nachher["createdAt"] == vorher["createdAt"]


def test_ruehrcharge_neu_ist_aktiv(app):
    app.post("/api/honey_stir_batches", {"honeyType": "Raps", "status": "done", "conclusion": "x"})
    b = app.get("/api/honey_stir_batches")[0]
    assert b["status"] == "active" and b["conclusion"] == ""


def test_tracht_name_wird_getrimmt(app):
    tid = app.post("/api/trachten", {"name": "  Linde  "})["id"]
    assert [t["name"] for t in app.get("/api/trachten") if t["id"] == tid] == ["Linde"]
    app.put(f"/api/trachten/{tid}", {"name": " Lindenhonig "})
    assert [t["name"] for t in app.get("/api/trachten") if t["id"] == tid] == ["Lindenhonig"]


def test_sirup_nur_20_neueste(app):
    for i in range(25):
        app.post("/api/sirup_calc", {"createdAt": f"2026-11-{i+1:02d}T00:00:00"})
    assert len(app.get("/api/sirup_calc")) == 20


def test_waage_loeschen_entfernt_zuordnung(app):
    sid = app.post("/api/scales", {"name": "W", "url": "https://x"})["id"]
    _, cid = _volk(app, scaleId=sid)
    app.delete(f"/api/scales/{sid}")
    assert app.get(f"/api/colonies/{cid}")["scaleId"] == ""


def test_json_null_wird_standardwert(app):
    _, cid = _volk(app)
    app.post("/api/entries", {"colonyId": cid, "obs": None, "obs_extra": None, "photos": None})
    e = app.get(f"/api/entries?colonyId={cid}")[0]
    assert e["obs"] == [] and e["obs_extra"] == {} and e["photos"] == []


def test_schema_ist_einzige_quelle(app):
    """Jede Tabelle der Datenbank (ausser settings) steht in SCHEMA und hat
    dort genau die Spalten, die auch in der Datenbank sind."""
    con = app.db()
    for (t,) in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name!='settings'"):
        db_spalten = [r[1] for r in con.execute(f"PRAGMA table_info({t})")]
        assert db_spalten == [sp.name for sp in app.server.SCHEMA[t]], t
    con.close()
