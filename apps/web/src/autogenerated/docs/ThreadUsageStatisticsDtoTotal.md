# ThreadUsageStatisticsDtoTotal

Total usage statistics for the entire thread

## Properties

| Name                  | Type        | Description                                                | Notes                             |
| --------------------- | ----------- | ---------------------------------------------------------- | --------------------------------- |
| **inputTokens**       | **number**  | Input tokens                                               | [default to undefined]            |
| **cachedInputTokens** | **number**  | Cached input tokens                                        | [optional] [default to undefined] |
| **outputTokens**      | **number**  | Output tokens                                              | [default to undefined]            |
| **reasoningTokens**   | **number**  | Reasoning tokens                                           | [optional] [default to undefined] |
| **totalTokens**       | **number**  | Total tokens                                               | [default to undefined]            |
| **totalPrice**        | **number**  |                                                            | [optional] [default to undefined] |
| **currentContext**    | **number**  | Current context size in tokens (snapshot, not additive)    | [optional] [default to undefined] |
| **hasUnpricedCalls**  | **boolean** | True if any contributing LLM call returned unknown pricing | [optional] [default to false]     |

## Example

```typescript
import { ThreadUsageStatisticsDtoTotal } from './api';

const instance: ThreadUsageStatisticsDtoTotal = {
  inputTokens,
  cachedInputTokens,
  outputTokens,
  reasoningTokens,
  totalTokens,
  totalPrice,
  currentContext,
  hasUnpricedCalls,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
