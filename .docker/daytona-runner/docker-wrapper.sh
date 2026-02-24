#!/bin/sh
# Docker wrapper that strips --storage-opt arguments for DinD environments
# where the overlay2 filesystem doesn't support pquota (e.g., Podman VM).
# The real Docker binary is at /usr/bin/docker.real

args=""
skip_next=0
for arg in "$@"; do
  if [ $skip_next -eq 1 ]; then
    skip_next=0
    continue
  fi
  case "$arg" in
    --storage-opt)
      skip_next=1
      continue
      ;;
    --storage-opt=*)
      continue
      ;;
    *)
      args="$args $arg"
      ;;
  esac
done

exec /usr/bin/docker.real $args
