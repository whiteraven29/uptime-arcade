# Runs one player's Go code with real `go test`. Started the same way as the Python image.
FROM golang:1.24-alpine
ENV CGO_ENABLED=0 GOTOOLCHAIN=local GOPROXY=off GOFLAGS=-mod=mod
COPY warm_test.go /tmp/warm/warm_test.go
RUN cd /tmp/warm && printf 'module warm\n\ngo 1.22\n' > go.mod && GOCACHE=/opt/gocache go test -vet=off ./... && cd / && rm -rf /tmp/warm && chmod -R a+rX /opt/gocache
COPY run_go.sh /opt/run.sh
ENV GOCACHE=/tmp/gocache GOTMPDIR=/tmp HOME=/tmp
USER 65534:65534
ENTRYPOINT ["/opt/run.sh"]
