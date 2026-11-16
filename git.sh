#!/bin/sh
# git via dulwich (no git binary here): ./git.sh status | add . | commit -m msg | log
cd "$(dirname "$0")" && PYTHONPATH=/mnt/d/workspace/kitesurf/tools/pylib exec python3 -m dulwich "$@"
