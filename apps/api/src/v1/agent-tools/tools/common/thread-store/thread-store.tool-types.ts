import { ThreadStoreEntryMode } from '../../../../thread-store/thread-store.types';

export interface ThreadStoreEntryOutput {
  namespace: string;
  key: string;
  value: string;
  mode: ThreadStoreEntryMode;
  authorAgentId: string | null;
  tags: string[] | null;
  createdAt: string;
  updatedAt: string;
}
