"""Gemeinsame Test-Hilfen: startet server.py in-process mit eigenem,
leerem Datenordner (tmp_path) auf einem freien Port, ohne Login.

Ausfuehren im Projektordner:  python3 -m pytest tests/ -q
"""
import importlib
import json
import os
import sys
import threading
import urllib.error
import urllib.request

import pytest

PROJEKT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJEKT not in sys.path:
    sys.path.insert(0, PROJEKT)


class Client:
    def __init__(self, server_modul, httpd, datadir):
        self.server = server_modul
        self.httpd = httpd
        self.datadir = datadir
        self.url = f"http://127.0.0.1:{httpd.server_port}"

    def request(self, methode, pfad, body=None, raw=None, content_type="application/json"):
        if raw is not None:
            daten = raw
        elif body is not None:
            daten = json.dumps(body).encode()
        else:
            daten = None
        req = urllib.request.Request(self.url + pfad, data=daten, method=methode,
                                     headers={"Content-Type": content_type})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.status, resp.read(), resp.headers
        except urllib.error.HTTPError as e:
            return e.code, e.read(), e.headers

    def json(self, methode, pfad, body=None, **kw):
        status, daten, _ = self.request(methode, pfad, body, **kw)
        assert status == 200, (methode, pfad, status, daten[:300])
        return json.loads(daten)

    def get(self, pfad):
        return self.json("GET", pfad)

    def post(self, pfad, body=None):
        return self.json("POST", pfad, body if body is not None else {})

    def put(self, pfad, body):
        return self.json("PUT", pfad, body)

    def delete(self, pfad):
        return self.json("DELETE", pfad)

    def db(self):
        return self.server.db()


def _starte(datadir, monkeypatch):
    os.makedirs(datadir, exist_ok=True)
    monkeypatch.setenv("IMKEREI_DATA", str(datadir))
    monkeypatch.setenv("IMKEREI_ZUGANG_AUS", "1")
    import server
    server = importlib.reload(server)
    os.makedirs(server.PHOTO_DIR, exist_ok=True)
    server.init_db()
    httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return Client(server, httpd, str(datadir))


@pytest.fixture
def app(tmp_path, monkeypatch):
    c = _starte(tmp_path / "data", monkeypatch)
    yield c
    c.httpd.shutdown()
    c.httpd.server_close()


@pytest.fixture
def zweite_app(tmp_path, monkeypatch):
    """Zweite, leere Instanz (z. B. Ziel fuer einen Restore). Achtung: Das
    Modul `server` ist global - nach dem Start dieser Instanz zeigen dessen
    Pfad-Konstanten auf den zweiten Datenordner. Deshalb erst die erste
    Instanz fertig benutzen (Export), dann diese hier anfordern ueber
    `request.getfixturevalue('zweite_app')`."""
    c = _starte(tmp_path / "data2", monkeypatch)
    yield c
    c.httpd.shutdown()
    c.httpd.server_close()
