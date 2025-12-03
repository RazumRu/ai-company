FROM node:22

ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /app

# core
RUN apt-get update -y && apt-get install -y --no-install-recommends \
  ca-certificates \
  git \
  curl \
  openssh-client \
  jq

# files tools
RUN apt-get install -y --no-install-recommends \
  ripgrep \
  fd-find \
  autoconf \
  automake \
  pkg-config \
  libseccomp-dev \
  libjansson-dev \
  libyaml-dev \
  libxml2-dev \
  && ln -s /usr/bin/fdfind /usr/local/bin/fd \
  && git clone https://github.com/universal-ctags/ctags.git /tmp/ctags \
  && cd /tmp/ctags && ./autogen.sh && ./configure --prefix=/usr && make && make install \
  && rm -rf /tmp/ctags

# gh tools
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
  && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
  && printf "deb [arch=%s signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main\n" "$(dpkg --print-architecture)" > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update -y \
  && apt-get install -y --no-install-recommends gh \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable
