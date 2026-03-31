# RuntimeHealthDto

## Properties

| Name        | Type        | Description                               | Notes                             |
| ----------- | ----------- | ----------------------------------------- | --------------------------------- |
| **healthy** | **boolean** | Whether the runtime backend is reachable  | [default to undefined]            |
| **type**    | **string**  | Runtime type checked                      | [default to undefined]            |
| **error**   | **string**  | Error message if the runtime is unhealthy | [optional] [default to undefined] |

## Example

```typescript
import { RuntimeHealthDto } from './api';

const instance: RuntimeHealthDto = {
  healthy,
  type,
  error,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
