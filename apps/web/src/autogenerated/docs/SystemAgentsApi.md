# SystemAgentsApi

All URIs are relative to _http://localhost_

| Method                  | HTTP request                       | Description |
| ----------------------- | ---------------------------------- | ----------- |
| [**getAll**](#getall)   | **GET** /api/v1/system-agents      |             |
| [**getById**](#getbyid) | **GET** /api/v1/system-agents/{id} |             |

# **getAll**

> Array<SystemAgentResponseDto> getAll()

### Example

```typescript
import { SystemAgentsApi, Configuration } from './api';

const configuration = new Configuration();
const apiInstance = new SystemAgentsApi(configuration);

const { status, data } = await apiInstance.getAll();
```

### Parameters

This endpoint does not have any parameters.

### Return type

**Array<SystemAgentResponseDto>**

### Authorization

[bearer](../README.md#bearer)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
| ----------- | ----------- | ---------------- |
| **200**     |             | -                |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **getById**

> SystemAgentResponseDto getById()

### Example

```typescript
import { SystemAgentsApi, Configuration } from './api';

const configuration = new Configuration();
const apiInstance = new SystemAgentsApi(configuration);

let id: string; // (default to undefined)

const { status, data } = await apiInstance.getById(id);
```

### Parameters

| Name   | Type         | Description | Notes                 |
| ------ | ------------ | ----------- | --------------------- |
| **id** | [**string**] |             | defaults to undefined |

### Return type

**SystemAgentResponseDto**

### Authorization

[bearer](../README.md#bearer)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
| ----------- | ----------- | ---------------- |
| **200**     |             | -                |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)
