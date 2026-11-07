#!/bin/sh
# Inside the sandbox. The job arrives as a tar on stdin, so nothing from the host is ever mounted.
set -e
mkdir /tmp/w
cd /tmp/w
tar xf -
exec python3 -I program.py
