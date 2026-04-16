# CreateGraphDto

## Properties

| Name             | Type                                                    | Description                                  | Notes                             |
| ---------------- | ------------------------------------------------------- | -------------------------------------------- | --------------------------------- |
| **name**         | **string**                                              |                                              | [default to undefined]            |
| **description**  | **string**                                              |                                              | [optional] [default to undefined] |
| **schema**       | [**CreateGraphDtoSchema**](CreateGraphDtoSchema.md)     |                                              | [default to undefined]            |
| **metadata**     | [**CreateGraphDtoMetadata**](CreateGraphDtoMetadata.md) |                                              | [optional] [default to undefined] |
| **temporary**    | **boolean**                                             |                                              | [optional] [default to false]     |
| **settings**     | **{ [key: string]: any; }**                             | Arbitrary per-graph settings stored as JSONB | [optional] [default to undefined] |
| **costLimitUsd** | **number**                                              |                                              | [optional] [default to undefined] |

## Example

```typescript
import { CreateGraphDto } from './api';

const instance: CreateGraphDto = {
  name,
  description,
  schema,
  metadata,
  temporary,
  settings,
  costLimitUsd,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
