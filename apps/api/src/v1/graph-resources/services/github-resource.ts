import { Injectable, Scope } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';
import outdent from 'outdent';

import { IShellResourceOutput, ResourceKind } from '../graph-resources.types';
import { BaseResource } from './base-resource';

export interface GithubResourceConfig {
  patToken: string;
  name?: string;
  email?: string;
  auth?: boolean;
}

export interface IGithubResourceOutput extends IShellResourceOutput {
  patToken: string;
}

@Injectable({ scope: Scope.TRANSIENT })
export class GithubResource extends BaseResource<
  GithubResourceConfig,
  IGithubResourceOutput
> {
  constructor(logger: DefaultLogger) {
    super(logger);
  }

  public async getData(
    config: GithubResourceConfig,
  ): Promise<IGithubResourceOutput> {
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
          ...(config.auth !== false
            ? [
                '[ -n "${GITHUB_PAT_TOKEN:-}" ] && printf "%s" "$GITHUB_PAT_TOKEN" | gh auth login --hostname github.com --with-token',
                'gh auth setup-git',
                'gh auth status',
              ]
            : []),
          'gh config set git_protocol https',
          'git config --global pull.rebase false',
          ...(config.name
            ? [`git config --global user.name "${config.name}"`]
            : []),
          ...(config.email
            ? [`git config --global user.email "${config.email}"`]
            : []),
        ].join(' && '),
        env: {
          GITHUB_PAT_TOKEN: config.patToken,
        },
      },
    };
  }
}
