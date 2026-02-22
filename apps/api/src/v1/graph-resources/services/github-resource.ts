import { Injectable, Scope } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';
import outdent from 'outdent';

import {
  GitHubAuthMethod,
  IShellResourceOutput,
  ResourceKind,
} from '../graph-resources.types';
import { BaseResource } from './base-resource';

export interface GithubResourceConfig {
  patToken?: string;
  name?: string;
  email?: string;
  auth?: boolean;
  authMethod?: GitHubAuthMethod;
}

export interface IGithubResourceOutput extends IShellResourceOutput {
  patToken?: string;
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
          ...(config.auth !== false && config.patToken
            ? [
                '[ -n "${GITHUB_PAT_TOKEN:-}" ] && printf "%s" "$GITHUB_PAT_TOKEN" | gh auth login --hostname github.com --with-token',
                'gh auth setup-git',
                'gh auth status',
              ]
            : []),
          // GitHub App auth: configure git to use GH_TOKEN as credential
          ...(config.auth !== false &&
          !config.patToken &&
          config.authMethod === GitHubAuthMethod.GithubApp
            ? [
                'git config --global credential.helper \'!f() { test "$1" = get && echo "protocol=https" && echo "host=github.com" && echo "username=x-access-token" && echo "password=${GH_TOKEN}"; }; f\'',
              ]
            : []),
          'gh config set git_protocol https',
          'git config --global pull.rebase false',
          `git config --global user.name "${config.name || 'Geniro Bot'}"`,
          `git config --global user.email "${config.email || 'bot@geniro.io'}"`,
        ].join(' && '),
        env: {
          ...(config.patToken ? { GITHUB_PAT_TOKEN: config.patToken } : {}),
        },
      },
    };
  }
}
