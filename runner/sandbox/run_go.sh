#!/bin/sh
# Inside the sandbox. The compiled standard library is copied in, so a job takes a second or two instead of a minute.
set -e
cp -r /opt/gocache /tmp/gocache
mkdir /tmp/w
cd /tmp/w
tar xf -
exec go test -vet=off -timeout 10s ./...
