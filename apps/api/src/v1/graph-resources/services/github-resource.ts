import { Injectable, Scope } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';
import outdent from 'outdent';

import {
  IShellResourceOutput,
  ResourceKind,
} from '../graph-resources.types';
import { BaseResource } from './base-resource';

export interface GithubResourceConfig {
  name?: string;
  email?: string;
  auth?: boolean;
}

export type IGithubResourceOutput = IShellResourceOutput;

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
        Authentication: Uses GitHub App installation tokens. The GitHub App must be installed on the target organization/account and linked in Settings > Integrations.

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
        initScriptTimeout: 300000,
        initScript: [
          'set -eu',
          ...(config.auth !== false
            ? [
                'git config --global credential.helper \'!f() { test "$1" = get && echo "protocol=https" && echo "host=github.com" && echo "username=x-access-token" && echo "password=${GH_TOKEN}"; }; f\'',
              ]
            : []),
          'gh config set git_protocol https',
          'git config --global pull.rebase false',
          `git config --global user.name "${config.name || 'Geniro Bot'}"`,
          `git config --global user.email "${config.email || 'bot@geniro.io'}"`,
        ].join(' && '),
        env: {},
      },
    };
  }
}
