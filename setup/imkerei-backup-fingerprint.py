#!/usr/bin/env python3
"""Fingerabdruck des BeeTown-App-Ordners fuer "Backup nur bei Aenderung".

Wird vom naechtlichen Timer-Lauf (imkerei-backup.sh --nur-bei-aenderung)
genutzt: stimmt der Fingerabdruck mit dem des letzten Backups ueberein, wird
kein neues Archiv geschrieben - im Winter wird die App oft wochenlang nicht
benutzt, dann entstehen sonst jede Nacht identische Archive auf der SD-Karte.

Bewusst NICHT einfach Dateizeiten/-pruefsummen von app.db: die DB laeuft im
WAL-Modus (app.db-wal/-shm aendern sich auch ohne echte Aenderung), und die
App schreibt selbst Eintraege, die keine Nutzer-Aenderung sind (z. B.
'_lastBackupAt' beim JSON-Export). Deshalb wird der DB-INHALT gehasht
(nur lesend geoeffnet), alle uebrigen Dateien (Fotos, Logo, Code) ueber
Pfad + Groesse + Aenderungszeit. Schreibt nichts, gibt nur den Hash aus.

Aufruf: imkerei-backup-fingerprint.py <app_ordner>
"""
import hashlib
import os
import sqlite3
import sys

DB_REL = os.path.join("data", "app.db")
DB_SKIP_FILES = {"app.db", "app.db-wal", "app.db-shm", "app.db-journal"}
# (tabelle, schluessel) - Eintraege, die die App selbst schreibt
IGNORED_SETTINGS = {"_lastBackupAt"}


def hash_db(h, db_path):
    if not os.path.isfile(db_path):
        h.update(b"no-db")
        return
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        objects = con.execute(
            "SELECT type, name, sql FROM sqlite_master ORDER BY type, name").fetchall()
        for typ, name, sql in objects:
            h.update(repr((typ, name, sql)).encode())
            if typ != "table" or name.startswith("sqlite_"):
                continue
            ncols = len(con.execute(f'SELECT * FROM "{name}" LIMIT 0').description)
            order = ",".join(str(i) for i in range(1, ncols + 1))
            for row in con.execute(f'SELECT * FROM "{name}" ORDER BY {order}'):
                if name == "settings" and row and row[0] in IGNORED_SETTINGS:
                    continue
                h.update(repr(row).encode())
    finally:
        con.close()


def hash_files(h, src_dir):
    for root, dirs, files in os.walk(src_dir):
        dirs[:] = sorted(d for d in dirs if d != "__pycache__")
        rel_root = os.path.relpath(root, src_dir)
        for name in sorted(files):
            if rel_root == "data" and name in DB_SKIP_FILES:
                continue
            st = os.lstat(os.path.join(root, name))
            h.update(repr((os.path.join(rel_root, name), st.st_size, int(st.st_mtime))).encode())


def main():
    if len(sys.argv) != 2:
        print("Aufruf: imkerei-backup-fingerprint.py <app_ordner>", file=sys.stderr)
        return 2
    src_dir = sys.argv[1]
    h = hashlib.sha256()
    hash_db(h, os.path.join(src_dir, DB_REL))
    hash_files(h, src_dir)
    print(h.hexdigest())
    return 0


if __name__ == "__main__":
    sys.exit(main())
