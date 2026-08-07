#!/bin/bash
# Duenner Verweis auf das eigentliche Installationsskript in setup/ - nur
# damit man es auch findet, wenn man den kompletten Projekt-Ordner kopiert
# hat, ohne extra nach setup/ wechseln zu muessen. Die eigentliche Logik
# lebt ausschliesslich in setup/install.sh - hier NICHTS duplizieren.
set -euo pipefail
exec bash "$(dirname "${BASH_SOURCE[0]}")/setup/install.sh" "$@"
