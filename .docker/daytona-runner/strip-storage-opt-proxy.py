#!/usr/bin/env python3
"""
Docker socket proxy that strips StorageOpt from container create requests.

Needed for DinD environments (e.g., Podman VM) where the overlay2 filesystem
reports XFS+prjquota but the kernel doesn't actually support project quotas,
causing Docker to reject --storage-opt arguments.

Usage:
  python3 strip-storage-opt-proxy.py /var/run/docker-real.sock /var/run/docker.sock

This creates a new Unix socket at /var/run/docker.sock that proxies to the real
Docker daemon socket at /var/run/docker-real.sock, stripping StorageOpt from
POST /containers/create requests.
"""

import json
import os
import re
import select
import socket
import sys
import threading

BUFFER_SIZE = 65536


def strip_storage_opt(body: bytes) -> bytes:
    """Remove StorageOpt from a container create JSON body."""
    try:
        data = json.loads(body)
        host_config = data.get("HostConfig", {})
        if "StorageOpt" in host_config:
            del host_config["StorageOpt"]
            return json.dumps(data).encode()
    except (json.JSONDecodeError, UnicodeDecodeError):
        pass
    return body


def parse_http_request(data: bytes):
    """Parse an HTTP request, returning (method, path, headers_end_idx, content_length)."""
    try:
        header_end = data.find(b"\r\n\r\n")
        if header_end == -1:
            return None, None, -1, 0

        header_section = data[:header_end].decode("utf-8", errors="replace")
        lines = header_section.split("\r\n")
        if not lines:
            return None, None, -1, 0

        request_line = lines[0]
        parts = request_line.split(" ")
        if len(parts) < 2:
            return None, None, -1, 0

        method = parts[0]
        path = parts[1]

        content_length = 0
        for line in lines[1:]:
            if line.lower().startswith("content-length:"):
                content_length = int(line.split(":", 1)[1].strip())
                break

        return method, path, header_end + 4, content_length
    except Exception:
        return None, None, -1, 0


def update_content_length(header_bytes: bytes, new_length: int) -> bytes:
    """Update the Content-Length header in raw HTTP headers."""
    header_str = header_bytes.decode("utf-8", errors="replace")
    updated = re.sub(
        r"(?i)content-length:\s*\d+",
        f"Content-Length: {new_length}",
        header_str,
    )
    return updated.encode()


def handle_client(client_sock: socket.socket, real_sock_path: str):
    """Handle a single client connection."""
    upstream = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        upstream.connect(real_sock_path)
    except Exception as e:
        print(f"[proxy] Failed to connect to upstream: {e}", file=sys.stderr)
        client_sock.close()
        return

    try:
        # Read the full request from client
        request_data = b""
        client_sock.setblocking(False)

        # First read — get at least the headers
        client_sock.setblocking(True)
        client_sock.settimeout(30)
        chunk = client_sock.recv(BUFFER_SIZE)
        if not chunk:
            return
        request_data = chunk

        method, path, body_start, content_length = parse_http_request(request_data)

        # Check if this is a container create request that needs patching
        needs_patch = (
            method == "POST"
            and path is not None
            and "/containers/create" in path
            and content_length > 0
        )

        if needs_patch:
            # Read the full body
            body_received = len(request_data) - body_start
            while body_received < content_length:
                chunk = client_sock.recv(
                    min(BUFFER_SIZE, content_length - body_received)
                )
                if not chunk:
                    break
                request_data += chunk
                body_received += len(chunk)

            headers = request_data[:body_start]
            body = request_data[body_start : body_start + content_length]

            new_body = strip_storage_opt(body)

            if len(new_body) != len(body):
                headers = update_content_length(headers, len(new_body))
                request_data = headers + new_body
                print(
                    f"[proxy] Stripped StorageOpt from {path}",
                    file=sys.stderr,
                )

        # Forward to upstream
        upstream.sendall(request_data)

        # Now bidirectionally proxy the rest
        client_sock.setblocking(False)
        upstream.setblocking(False)

        while True:
            readable, _, errored = select.select(
                [client_sock, upstream], [], [client_sock, upstream], 60
            )
            if errored:
                break
            if not readable:
                break  # timeout

            done = False
            for sock in readable:
                try:
                    data = sock.recv(BUFFER_SIZE)
                    if not data:
                        done = True
                        break
                    if sock is client_sock:
                        upstream.sendall(data)
                    else:
                        client_sock.sendall(data)
                except (ConnectionError, OSError):
                    done = True
                    break
            if done:
                break

    except Exception as e:
        print(f"[proxy] Error: {e}", file=sys.stderr)
    finally:
        client_sock.close()
        upstream.close()


def main():
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <real-socket> <proxy-socket>", file=sys.stderr)
        sys.exit(1)

    real_sock_path = sys.argv[1]
    proxy_sock_path = sys.argv[2]

    # Remove old proxy socket
    if os.path.exists(proxy_sock_path):
        os.unlink(proxy_sock_path)

    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(proxy_sock_path)
    os.chmod(proxy_sock_path, 0o660)
    server.listen(64)

    print(
        f"[proxy] Listening on {proxy_sock_path}, forwarding to {real_sock_path}",
        file=sys.stderr,
    )

    while True:
        client_sock, _ = server.accept()
        t = threading.Thread(target=handle_client, args=(client_sock, real_sock_path))
        t.daemon = True
        t.start()


if __name__ == "__main__":
    main()
