import { Injectable, Scope } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';
import outdent from 'outdent';

import { IShellResourceOutput, ResourceKind } from '../graph-resources.types';
import { BaseResource } from './base-resource';

export interface GithubResourceConfig {
  patToken: string;
}

@Injectable({ scope: Scope.TRANSIENT })
export class GithubResource extends BaseResource<
  GithubResourceConfig,
  IShellResourceOutput
> {
  constructor(logger: DefaultLogger) {
    super(logger);
  }

  public async getData(
    config: GithubResourceConfig,
  ): Promise<IShellResourceOutput> {
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
      data: {
        initScriptTimeout: 120000,
        initScript: [
          'export DEBIAN_FRONTEND=noninteractive',
          'apt-get update -y',
          'apt-get install -y curl ca-certificates jq git',
          'curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | tee /usr/share/keyrings/githubcli-archive-keyring.gpg >/dev/null',
          'chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg',
          'echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list',
          'apt-get update -y',
          'apt-get install -y gh',
          'printf "%s" "$GITHUB_PAT_TOKEN" | gh auth login --hostname github.com --with-token',
          'gh config set git_protocol https',
          'git config --global pull.rebase false',
          'gh auth status || true',
        ].join(' && '),
        env: {
          GITHUB_PAT_TOKEN: config.patToken,
        },
      },
    };
  }
}
