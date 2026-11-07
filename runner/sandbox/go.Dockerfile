# Runs one player's Go code with real `go test`. Started the same way as the Python image.
FROM golang:1.24-alpine
ENV CGO_ENABLED=0 GOTOOLCHAIN=local GOPROXY=off GOFLAGS=-mod=mod
RUN GOCACHE=/opt/gocache go build fmt strconv strings errors sync sort time testing && chmod -R a+rX /opt/gocache
COPY run_go.sh /opt/run.sh
ENV GOCACHE=/tmp/gocache GOTMPDIR=/tmp HOME=/tmp
USER 65534:65534
ENTRYPOINT ["/opt/run.sh"]
