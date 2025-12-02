import { Injectable, Scope } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';
import outdent from 'outdent';

import { IShellResourceOutput, ResourceKind } from '../graph-resources.types';
import { BaseResource } from './base-resource';

export interface GithubResourceConfig {
  patToken: string;
  name?: string;
  avatar?: string;
  auth?: boolean;
}

export interface IGithubResourceResourceOutput extends IShellResourceOutput {
  patToken: string;
}

@Injectable({ scope: Scope.TRANSIENT })
export class GithubResource extends BaseResource<
  GithubResourceConfig,
  IGithubResourceResourceOutput
> {
  constructor(logger: DefaultLogger) {
    super(logger);
  }

  public async getData(
    config: GithubResourceConfig,
  ): Promise<IGithubResourceResourceOutput> {
    return {
      information: outdent`
        Purpose: Work with GitHub from shell via gh CLI (repos, branches, PRs, issues, workflows).

        Discover commands:
          gh help
          gh <group> --help
          gh help <command>
          gh alias list
          gh extension list
          gh api --help
      `,
      kind: ResourceKind.Shell,
      patToken: config.patToken,
      data: {
        initScriptTimeout: 300000,
        initScript: [
          'set -eu',
          'export DEBIAN_FRONTEND=noninteractive',
          'if command -v apk >/dev/null 2>&1; then apk add --no-cache curl ca-certificates jq git openssh || exit 1; if ! apk add --no-cache github-cli >/dev/null 2>&1; then GH_VER=2.62.0; TMP="$(mktemp -d)"; ARCH="$(apk --print-arch)"; case "$ARCH" in x86_64) GH_ARCH=amd64;; aarch64) GH_ARCH=arm64;; armv7) GH_ARCH=armv6;; *) echo "Unsupported arch: $ARCH" >&2; exit 1;; esac; curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VER}/gh_${GH_VER}_linux_${GH_ARCH}.tar.gz" -o "$TMP/gh.tgz"; tar -xf "$TMP/gh.tgz" -C "$TMP"; install -m 0755 "$TMP"/gh_*/bin/gh /usr/local/bin/gh; rm -rf "$TMP"; fi; elif command -v apt-get >/dev/null 2>&1; then apt-get update -y && apt-get install -y curl ca-certificates jq git && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg && printf "deb [arch=%s signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main\n" "$(dpkg --print-architecture)" > /etc/apt/sources.list.d/github-cli.list && apt-get update -y && apt-get install -y gh; elif command -v dnf >/dev/null 2>&1; then dnf install -y curl ca-certificates jq git && dnf config-manager --add-repo https://cli.github.com/packages/rpm/gh-cli.repo && dnf install -y gh; elif command -v yum >/dev/null 2>&1; then yum install -y curl ca-certificates jq git && yum-config-manager --add-repo https://cli.github.com/packages/rpm/gh-cli.repo && yum install -y gh; else echo "Unsupported base image" >&2; exit 1; fi',
          ...(config.auth !== false
            ? [
                'printf "%s" "$GITHUB_PAT_TOKEN" | gh auth login --hostname github.com --with-token',
                'gh auth status',
              ]
            : []),
          'gh config set git_protocol https',
          'git config --global pull.rebase false',
          ...(config.name
            ? [`git config --global user.name "${config.name}"`]
            : []),
        ].join(' && '),
        env: {
          GITHUB_PAT_TOKEN: config.patToken,
        },
      },
    };
  }
}
