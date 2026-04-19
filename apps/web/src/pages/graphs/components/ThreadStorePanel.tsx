import { Database, Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../../components/ui/collapsible';
import { ScrollArea } from '../../../components/ui/scroll-area';
import { cn } from '../../../components/ui/utils';
import { useWebSocketEvent } from '../../../hooks/useWebSocket';
import {
  threadStoreApi,
  type ThreadStoreEntry,
  type ThreadStoreNamespaceSummary,
} from '../../../services/threadStoreApi';
import type { ThreadStoreUpdateNotification } from '../../../services/WebSocketTypes';

interface ThreadStorePanelProps {
  /** Internal DB thread id (UUID). Required for REST calls. */
  threadId: string;
  /**
   * External thread id (graphId:subId). Used to filter websocket events,
   * which are scoped to the external id.
   */
  externalThreadId?: string;
  className?: string;
  defaultOpen?: boolean;
}

const formatTimestamp = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString();
};

const formatValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

export const ThreadStorePanel: React.FC<ThreadStorePanelProps> = ({
  threadId,
  externalThreadId,
  className,
  defaultOpen = false,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const [namespaces, setNamespaces] = useState<ThreadStoreNamespaceSummary[]>(
    [],
  );
  const [activeNamespace, setActiveNamespace] = useState<string | null>(null);
  const [entries, setEntries] = useState<ThreadStoreEntry[]>([]);
  const [loadingNamespaces, setLoadingNamespaces] = useState(false);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchNamespaces = useCallback(async () => {
    setLoadingNamespaces(true);
    setError(null);
    try {
      const data = await threadStoreApi.listNamespaces(threadId);
      setNamespaces(data);
      if (
        data.length > 0 &&
        !data.some((n) => n.namespace === activeNamespace)
      ) {
        setActiveNamespace(data[0]!.namespace);
      } else if (data.length === 0) {
        setActiveNamespace(null);
        setEntries([]);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load namespaces',
      );
    } finally {
      setLoadingNamespaces(false);
    }
  }, [threadId, activeNamespace]);

  const fetchEntries = useCallback(
    async (namespace: string) => {
      setLoadingEntries(true);
      try {
        const data = await threadStoreApi.listEntries(threadId, namespace, {
          limit: 100,
        });
        setEntries(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load entries');
      } finally {
        setLoadingEntries(false);
      }
    },
    [threadId],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    void fetchNamespaces();
  }, [open, fetchNamespaces]);

  useEffect(() => {
    if (!open || !activeNamespace) {
      return;
    }
    void fetchEntries(activeNamespace);
  }, [open, activeNamespace, fetchEntries]);

  useWebSocketEvent('thread.store.update', (event) => {
    const notification = event as ThreadStoreUpdateNotification;
    const eventExternalId = notification.threadId;
    const eventInternalId = notification.data.threadId;

    const matchesExternal =
      externalThreadId && eventExternalId === externalThreadId;
    const matchesInternal = eventInternalId === threadId;

    if (!matchesExternal && !matchesInternal) {
      return;
    }

    if (!open) {
      return;
    }

    void fetchNamespaces();
    if (notification.data.namespace === activeNamespace) {
      void fetchEntries(notification.data.namespace);
    }
  });

  const totalEntries = useMemo(
    () => namespaces.reduce((sum, ns) => sum + ns.entryCount, 0),
    [namespaces],
  );

  const activeSummary = namespaces.find((n) => n.namespace === activeNamespace);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn(
        'rounded-md border border-border bg-card text-card-foreground',
        className,
      )}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm font-medium">
          <span className="flex items-center gap-2">
            <Database className="h-4 w-4" />
            Thread store
            {namespaces.length > 0 ? (
              <Badge variant="secondary" className="ml-1">
                {namespaces.length} ns · {totalEntries}
              </Badge>
            ) : null}
          </span>
          <span className="text-xs text-muted-foreground">
            {open ? 'Hide' : 'Show'}
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t border-border p-3 space-y-3">
          {error ? (
            <div className="text-sm text-destructive">{error}</div>
          ) : null}

          <div className="flex items-center gap-2 flex-wrap">
            {loadingNamespaces && namespaces.length === 0 ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : namespaces.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No entries yet. Agents can write here via the Thread Store tools
                (put, append).
              </p>
            ) : (
              namespaces.map((ns) => (
                <Button
                  key={ns.namespace}
                  type="button"
                  size="sm"
                  variant={
                    ns.namespace === activeNamespace ? 'default' : 'outline'
                  }
                  onClick={() => setActiveNamespace(ns.namespace)}>
                  {ns.namespace}
                  <Badge variant="secondary" className="ml-2">
                    {ns.entryCount}
                  </Badge>
                </Button>
              ))
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                void fetchNamespaces();
                if (activeNamespace) {
                  void fetchEntries(activeNamespace);
                }
              }}
              title="Refresh">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>

          {activeSummary ? (
            <div className="text-xs text-muted-foreground">
              Last update: {formatTimestamp(activeSummary.lastUpdatedAt)}
            </div>
          ) : null}

          {activeNamespace ? (
            <ScrollArea className="max-h-96">
              {loadingEntries && entries.length === 0 ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : entries.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  This namespace is empty.
                </p>
              ) : (
                <ul className="space-y-2">
                  {entries.map((entry) => (
                    <li
                      key={entry.id}
                      className="rounded-md border border-border bg-background p-2">
                      <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                        <span className="font-mono text-foreground break-all">
                          {entry.key}
                        </span>
                        <Badge
                          variant={
                            entry.mode === 'append' ? 'secondary' : 'outline'
                          }>
                          {entry.mode}
                        </Badge>
                        {entry.authorAgentId ? (
                          <Badge variant="outline">{entry.authorAgentId}</Badge>
                        ) : null}
                        <span>{formatTimestamp(entry.updatedAt)}</span>
                      </div>
                      {entry.tags && entry.tags.length > 0 ? (
                        <div className="mt-1 flex items-center gap-1 flex-wrap">
                          {entry.tags.map((tag) => (
                            <Badge key={tag} variant="secondary">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                      <pre className="mt-2 whitespace-pre-wrap break-words text-xs font-mono text-foreground bg-muted/40 rounded p-2">
                        {formatValue(entry.value)}
                      </pre>
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

export default ThreadStorePanel;
