FROM node:24

ENV DEBIAN_FRONTEND=noninteractive
ENV NO_COLOR=1
ENV FORCE_COLOR=0
ENV CLICOLOR=0
ENV CLICOLOR_FORCE=0
ENV TERM=dumb
ENV CI=true
ENV NODE_NO_WARNINGS=1
ENV DOCKER_TLS_CERTDIR=

WORKDIR /app

RUN apt-get update -y && apt-get install -y --no-install-recommends \
  ca-certificates \
  git \
  curl \
  openssh-client \
  jq \
  python3 \
  python3-pip \
  python3-venv \
  python3-dev \
  build-essential \
  apt-utils \
  gnupg \
  poppler-utils \
  ripgrep \
  fd-find \
  autoconf \
  automake \
  pkg-config \
  libseccomp-dev \
  libjansson-dev \
  libyaml-dev \
  libxml2-dev \
  libxslt1-dev \
  zlib1g-dev \
  && ln -s /usr/bin/python3 /usr/bin/python \
  && ln -s /usr/bin/fdfind /usr/local/bin/fd \
  && git clone https://github.com/universal-ctags/ctags.git /tmp/ctags \
  && cd /tmp/ctags && ./autogen.sh && ./configure --prefix=/usr && make && make install \
  && rm -rf /tmp/ctags \
  && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/py \
  && /opt/py/bin/pip install --no-cache-dir --upgrade pip setuptools wheel \
  && /opt/py/bin/pip install --no-cache-dir \
    requests \
    httpx \
    beautifulsoup4 \
    lxml \
    pandas \
    numpy \
    pypdf \
    pdfplumber \
    openpyxl

ENV PATH="/opt/py/bin:${PATH}"

RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
  && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
  && printf "deb [arch=%s signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main\n" "$(dpkg --print-architecture)" > /etc/apt/sources.list.d/github-cli.list \
  && install -m 0755 -d /etc/apt/keyrings \
  && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
  && chmod a+r /etc/apt/keyrings/docker.gpg \
  && printf "deb [arch=%s signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian %s stable\n" \
    "$(dpkg --print-architecture)" "$( . /etc/os-release && echo "$VERSION_CODENAME" )" \
    > /etc/apt/sources.list.d/docker.list \
  && apt-get update -y \
  && apt-get install -y --no-install-recommends \
    gh \
    docker-ce \
    docker-ce-cli \
    docker-buildx-plugin \
    docker-compose-plugin \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

RUN cat <<'EOF' > /usr/local/bin/runtime-entrypoint.sh
#!/bin/sh
set -e

mkdir -p /var/lib/docker

dockerd_args="--host=unix:///var/run/docker.sock --host=tcp://0.0.0.0:2375"

if [ -n "${DOCKER_REGISTRY_MIRRORS:-}" ]; then
  for mirror in $(echo "$DOCKER_REGISTRY_MIRRORS" | tr ',' ' '); do
    dockerd_args="$dockerd_args --registry-mirror=$mirror"
  done
fi

if [ -n "${DOCKER_INSECURE_REGISTRIES:-}" ]; then
  for registry in $(echo "$DOCKER_INSECURE_REGISTRIES" | tr ',' ' '); do
    dockerd_args="$dockerd_args --insecure-registry=$registry"
  done
fi

dockerd $dockerd_args >/var/log/dockerd.log 2>&1 &

tries=0
until docker info >/dev/null 2>&1; do
  tries=$((tries + 1))
  if [ "$tries" -ge 180 ]; then
    echo "dockerd failed to start" >&2
    tail -n 200 /var/log/dockerd.log >&2 || true
    exit 1
  fi
  sleep 0.5
done

exec "$@"
EOF

RUN chmod +x /usr/local/bin/runtime-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/runtime-entrypoint.sh"]
