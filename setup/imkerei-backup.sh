#!/bin/bash
# Taegliches (oder woechentliches) Backup des kompletten BeeTown-App-Ordners
# (Code + data/ inkl. SQLite-DB und Fotos). Wird immer lokal unter
# /opt/backup abgelegt (max. MAX_BACKUPS Archive, aeltere werden geloescht)
# UND zusaetzlich auf einen eingerichteten USB-Stick kopiert, falls einer
# unter USB_MOUNT eingehaengt ist (eigene Rotation dort).
set -euo pipefail

SRC_DIR="/opt/imkerei"
DEST_DIR="/opt/backup"
USB_MOUNT="/mnt/backup-usb"
CONFIG_FILE="/opt/backup-scripts/backup.conf"

MAX_BACKUPS=20
[ -f "$CONFIG_FILE" ] && source "$CONFIG_FILE"

mkdir -p "$DEST_DIR"

timestamp="$(date +%Y-%m-%d-%H%M%S)"
archive_name="imkerei-backup-$timestamp.tar.gz"
archive="$DEST_DIR/$archive_name"

tar czf "$archive" -C "$(dirname "$SRC_DIR")" "$(basename "$SRC_DIR")"
echo "Backup erstellt (lokal): $archive"

# Rotation lokal: nur die MAX_BACKUPS neuesten Archive behalten.
mapfile -t backups < <(ls -1t "$DEST_DIR"/imkerei-backup-*.tar.gz 2>/dev/null)
if (( ${#backups[@]} > MAX_BACKUPS )); then
    for old in "${backups[@]:MAX_BACKUPS}"; do
        rm -f -- "$old"
        echo "Altes Backup geloescht (lokal): $old"
    done
fi

# Zusaetzlich auf den USB-Stick kopieren, falls einer als Backup-Ziel
# eingerichtet ist. Erst versuchen, ihn (erneut) einzuhaengen: wurde der
# Stick zwischenzeitlich ab- und wieder angesteckt, ohne dass der Pi neu
# gestartet wurde, ist er sonst trotz vorhandenem fstab-Eintrag nicht
# eingehaengt. Kein Fehler, falls kein Stick da ist - das lokale Backup
# existiert in jedem Fall bereits.
mountpoint -q "$USB_MOUNT" || mount "$USB_MOUNT" >/dev/null 2>&1 || true
if mountpoint -q "$USB_MOUNT"; then
    cp "$archive" "$USB_MOUNT/$archive_name"
    echo "Backup zusaetzlich auf USB-Stick kopiert: $USB_MOUNT/$archive_name"

    mapfile -t usb_backups < <(ls -1t "$USB_MOUNT"/imkerei-backup-*.tar.gz 2>/dev/null)
    if (( ${#usb_backups[@]} > MAX_BACKUPS )); then
        for old in "${usb_backups[@]:MAX_BACKUPS}"; do
            rm -f -- "$old"
            echo "Altes Backup geloescht (USB-Stick): $old"
        done
    fi
else
    echo "Kein USB-Stick als Backup-Ziel eingehaengt - nur lokal gesichert."
fi
