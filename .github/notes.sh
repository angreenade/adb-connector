#!/usr/bin/env bash
# Prints the release notes for version $1: its CHANGELOG.md section plus download instructions.
v="$1"
awk -v v="$v" '$0 ~ "^## "v"( |$)" {on=1; next} /^## / {on=0} on' CHANGELOG.md | sed '/./,$!d'
cat <<TXT

---
**Download:** \`ADB-Connector-Setup-$v.exe\` below, then run it. Already installed? The app updates itself — use the button at the bottom left.
Windows may show "Windows protected your PC" the first time (the app isn't code-signed): click **More info → Run anyway**.
TXT
