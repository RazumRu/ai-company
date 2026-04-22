# ThreadUsageStatisticsDtoToolsAggregate

Aggregated statistics for all tool-related LLM requests

## Properties

| Name                  | Type        | Description                                                                                                                                                                        | Notes                             |
| --------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| **inputTokens**       | **number**  | Input tokens                                                                                                                                                                       | [default to undefined]            |
| **cachedInputTokens** | **number**  | Cached input tokens                                                                                                                                                                | [optional] [default to undefined] |
| **outputTokens**      | **number**  | Output tokens                                                                                                                                                                      | [default to undefined]            |
| **reasoningTokens**   | **number**  | Reasoning tokens                                                                                                                                                                   | [optional] [default to undefined] |
| **totalTokens**       | **number**  | Total tokens                                                                                                                                                                       | [default to undefined]            |
| **totalPrice**        | **number**  |                                                                                                                                                                                    | [optional] [default to undefined] |
| **currentContext**    | **number**  | Current context size in tokens (snapshot, not additive)                                                                                                                            | [optional] [default to undefined] |
| **hasUnpricedCalls**  | **boolean** | True if any contributing LLM call returned unknown pricing. Optional in Wave 1 (RED spec compile); tightened to required-with-default on ThreadTotalUsageSchema in Wave 2 Step 15. | [optional] [default to undefined] |
| **requestCount**      | **number**  | Number of requests (messages with requestTokenUsage)                                                                                                                               | [default to undefined]            |

## Example

```typescript
import { ThreadUsageStatisticsDtoToolsAggregate } from './api';

const instance: ThreadUsageStatisticsDtoToolsAggregate = {
  inputTokens,
  cachedInputTokens,
  outputTokens,
  reasoningTokens,
  totalTokens,
  totalPrice,
  currentContext,
  hasUnpricedCalls,
  requestCount,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
