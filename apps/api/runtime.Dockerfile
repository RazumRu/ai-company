FROM node:24

ENV DEBIAN_FRONTEND=noninteractive
ENV NO_COLOR=1
ENV FORCE_COLOR=0
ENV CLICOLOR=0
ENV CLICOLOR_FORCE=0
ENV TERM=dumb
ENV CI=true
ENV NODE_NO_WARNINGS=1
WORKDIR /app

RUN apt-get update -y && apt-get install -y --no-install-recommends \
  ca-certificates \
  git \
  curl \
  openssh-client \
  jq \
  python3 \
  python3-pip \
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
  && ln -s /usr/bin/python3 /usr/bin/python \
  && ln -s /usr/bin/fdfind /usr/local/bin/fd \
  && git clone https://github.com/universal-ctags/ctags.git /tmp/ctags \
  && cd /tmp/ctags && ./autogen.sh && ./configure --prefix=/usr && make && make install \
  && rm -rf /tmp/ctags

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
    docker-ce-cli \
    docker-buildx-plugin \
    docker-compose-plugin \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable
