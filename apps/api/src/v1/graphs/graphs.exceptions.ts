import { addExceptionCode } from '@packages/common';

addExceptionCode({
  GRAPH_NOT_FOUND: 'Graph not found',
  GRAPH_ALREADY_RUNNING: 'Graph is already running',
  GRAPH_ALREADY_REGISTERED: 'Graph is already registered',
  GRAPH_DUPLICATE_NODE: 'Duplicate node IDs found in graph schema',
  GRAPH_EDGE_NOT_FOUND: 'Edge references non-existent',
  GRAPH_NODE_NOT_FOUND: 'Node references non-existent',
  GRAPH_TEMPLATE_NOT_FOUND: 'Template not found',
  WRONG_EDGE_CONNECTION: 'Wrong edge connection',
  TEMPLATE_NOT_REGISTERED: 'Template is not registered',
});
