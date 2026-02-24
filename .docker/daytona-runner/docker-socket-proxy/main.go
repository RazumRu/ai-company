// docker-socket-proxy strips StorageOpt from Docker container create requests.
//
// This is needed for DinD in Podman VMs where overlay2 on XFS doesn't properly
// support project quotas despite the mount options claiming prjquota.
//
// Uses net/http server + httputil.ReverseProxy so that Go's standard library
// handles all HTTP protocol complexities (keep-alive, chunked encoding,
// streaming, connection upgrades). The proxy only modifies container create
// request bodies to remove StorageOpt.
//
// Usage:
//
//	docker-socket-proxy -real /var/run/docker-real.sock -proxy /var/run/docker.sock
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"os"
	"strings"
)

func main() {
	realSock := "/var/run/docker-real.sock"
	proxySock := "/var/run/docker.sock"

	args := os.Args[1:]
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "-real":
			if i+1 < len(args) {
				realSock = args[i+1]
				i++
			}
		case "-proxy":
			if i+1 < len(args) {
				proxySock = args[i+1]
				i++
			}
		}
	}

	os.Remove(proxySock)

	listener, err := net.Listen("unix", proxySock)
	if err != nil {
		log.Fatalf("Failed to listen on %s: %v", proxySock, err)
	}
	defer listener.Close()

	if err := os.Chmod(proxySock, 0660); err != nil {
		log.Printf("Warning: failed to chmod proxy socket: %v", err)
	}

	log.Printf("Listening on %s, forwarding to %s", proxySock, realSock)

	// Build a reverse proxy that dials the real Docker daemon socket.
	transport := &http.Transport{
		DialContext: func(_ context.Context, _, _ string) (net.Conn, error) {
			return net.Dial("unix", realSock)
		},
		// Disable compression so we don't modify response bodies
		DisableCompression: true,
	}

	proxy := &httputil.ReverseProxy{
		Director: func(req *http.Request) {
			// Rewrite the request to target the upstream Unix socket.
			// The Host header and URL scheme don't matter for Unix sockets
			// but we need them to be valid for the HTTP library.
			req.URL.Scheme = "http"
			req.URL.Host = "docker"

			isCreate := req.Method == "POST" && strings.Contains(req.URL.Path, "/containers/create")
			if isCreate && req.Body != nil {
				body, readErr := io.ReadAll(req.Body)
				req.Body.Close()
				if readErr == nil {
					newBody := stripStorageOptFromJSON(body)
					if newBody != nil {
						body = newBody
					}
					req.Body = io.NopCloser(bytes.NewReader(body))
					req.ContentLength = int64(len(body))
				}
			}
		},
		Transport: transport,
		// Stream the response body without buffering
		FlushInterval: -1,
		ErrorLog:      log.Default(),
	}

	server := &http.Server{
		Handler: proxy,
	}

	if err := server.Serve(listener); err != nil {
		log.Fatalf("Server error: %v", err)
	}
}

func stripStorageOptFromJSON(bodyJSON []byte) []byte {
	var containerConfig map[string]interface{}
	if err := json.Unmarshal(bodyJSON, &containerConfig); err != nil {
		return nil
	}

	hostConfig, ok := containerConfig["HostConfig"].(map[string]interface{})
	if !ok {
		return nil
	}

	storageOpt, hasStorageOpt := hostConfig["StorageOpt"]
	if !hasStorageOpt {
		return nil
	}

	delete(hostConfig, "StorageOpt")
	log.Printf("Stripped StorageOpt=%v from container create request", storageOpt)

	newBodyJSON, err := json.Marshal(containerConfig)
	if err != nil {
		log.Printf("Failed to re-encode JSON: %v", err)
		return nil
	}

	return newBodyJSON
}

func init() {
	log.SetOutput(os.Stderr)
	log.SetPrefix("[docker-socket-proxy] ")
	log.SetFlags(0)
}
