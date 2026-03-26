# SystemSettingsResponseDto

## Properties

| Name                         | Type        | Description                                                         | Notes                  |
| ---------------------------- | ----------- | ------------------------------------------------------------------- | ---------------------- |
| **githubAppEnabled**         | **boolean** | Whether the GitHub App integration is configured and available      | [default to undefined] |
| **litellmManagementEnabled** | **boolean** | Whether the LiteLLM model management UI is enabled for the frontend | [default to undefined] |
| **isAdmin**                  | **boolean** | Whether the current user has the admin role                         | [default to undefined] |
| **githubWebhookEnabled**     | **boolean** | Whether the GitHub webhook receiver is configured and available     | [default to undefined] |

## Example

```typescript
import { SystemSettingsResponseDto } from './api';

const instance: SystemSettingsResponseDto = {
  githubAppEnabled,
  litellmManagementEnabled,
  isAdmin,
  githubWebhookEnabled,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
