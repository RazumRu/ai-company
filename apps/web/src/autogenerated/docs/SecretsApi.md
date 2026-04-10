# SecretsApi

All URIs are relative to _http://localhost_

| Method                   | HTTP request                    | Description |
| ------------------------ | ------------------------------- | ----------- |
| [**\_delete**](#_delete) | **DELETE** /api/v1/secrets/{id} |             |
| [**create**](#create)    | **POST** /api/v1/secrets        |             |
| [**getById**](#getbyid)  | **GET** /api/v1/secrets/{id}    |             |
| [**list**](#list)        | **GET** /api/v1/secrets         |             |
| [**update**](#update)    | **PATCH** /api/v1/secrets/{id}  |             |

# **\_delete**

> \_delete()

### Example

```typescript
import { SecretsApi, Configuration } from './api';

const configuration = new Configuration();
const apiInstance = new SecretsApi(configuration);

let id: string; // (default to undefined)

const { status, data } = await apiInstance._delete(id);
```

### Parameters

| Name   | Type         | Description | Notes                 |
| ------ | ------------ | ----------- | --------------------- |
| **id** | [**string**] |             | defaults to undefined |

### Return type

void (empty response body)

### Authorization

[bearer](../README.md#bearer)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: Not defined

### HTTP response details

| Status code | Description | Response headers |
| ----------- | ----------- | ---------------- |
| **204**     |             | -                |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **create**

> SecretResponseDto create(createSecretDto)

### Example

```typescript
import { SecretsApi, Configuration, CreateSecretDto } from './api';

const configuration = new Configuration();
const apiInstance = new SecretsApi(configuration);

let createSecretDto: CreateSecretDto; //

const { status, data } = await apiInstance.create(createSecretDto);
```

### Parameters

| Name                | Type                | Description | Notes |
| ------------------- | ------------------- | ----------- | ----- |
| **createSecretDto** | **CreateSecretDto** |             |       |

### Return type

**SecretResponseDto**

### Authorization

[bearer](../README.md#bearer)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
| ----------- | ----------- | ---------------- |
| **201**     |             | -                |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **getById**

> SecretResponseDto getById()

### Example

```typescript
import { SecretsApi, Configuration } from './api';

const configuration = new Configuration();
const apiInstance = new SecretsApi(configuration);

let id: string; // (default to undefined)

const { status, data } = await apiInstance.getById(id);
```

### Parameters

| Name   | Type         | Description | Notes                 |
| ------ | ------------ | ----------- | --------------------- |
| **id** | [**string**] |             | defaults to undefined |

### Return type

**SecretResponseDto**

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

# **list**

> Array<SecretResponseDto> list()

### Example

```typescript
import { SecretsApi, Configuration } from './api';

const configuration = new Configuration();
const apiInstance = new SecretsApi(configuration);

const { status, data } = await apiInstance.list();
```

### Parameters

This endpoint does not have any parameters.

### Return type

**Array<SecretResponseDto>**

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

# **update**

> SecretResponseDto update(updateSecretDto)

### Example

```typescript
import { SecretsApi, Configuration, UpdateSecretDto } from './api';

const configuration = new Configuration();
const apiInstance = new SecretsApi(configuration);

let id: string; // (default to undefined)
let updateSecretDto: UpdateSecretDto; //

const { status, data } = await apiInstance.update(id, updateSecretDto);
```

### Parameters

| Name                | Type                | Description | Notes                 |
| ------------------- | ------------------- | ----------- | --------------------- |
| **updateSecretDto** | **UpdateSecretDto** |             |                       |
| **id**              | [**string**]        |             | defaults to undefined |

### Return type

**SecretResponseDto**

### Authorization

[bearer](../README.md#bearer)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
| ----------- | ----------- | ---------------- |
| **200**     |             | -                |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)
