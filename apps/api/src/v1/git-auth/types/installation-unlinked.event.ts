import { GitProvider } from './git-provider.enum';

export interface InstallationUnlinkedEvent {
  userId: string;
  provider: GitProvider;
  connectionIds: string[];
  accountLogins: string[];
  githubInstallationIds: number[];
}

export const INSTALLATION_UNLINKED_EVENT = 'installation.unlinked';
