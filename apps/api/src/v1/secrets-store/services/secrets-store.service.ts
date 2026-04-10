import { Injectable } from '@nestjs/common';
import { DefaultLogger, InternalException } from '@packages/common';

import { environment } from '../../../environments';

@Injectable()
export class SecretsStoreService {
  constructor(private readonly logger: DefaultLogger) {}

  /**
   * Returns true when OpenBao connection is configured via environment variables.
   * All methods will throw if this returns false.
   */
  isAvailable(): boolean {
    return Boolean(environment.openbaoAddr && environment.openbaoToken);
  }

  private assertAvailable(): void {
    if (!this.isAvailable()) {
      throw new InternalException(
        'SECRETS_STORE_UNAVAILABLE',
        'OpenBao is not configured. Set OPENBAO_ADDR and OPENBAO_TOKEN.',
      );
    }
  }

  private buildDataPath(projectId: string, secretName: string): string {
    return `${environment.openbaoAddr}/v1/secret/data/projects/${encodeURIComponent(projectId)}/${encodeURIComponent(secretName)}`;
  }

  private buildMetadataPath(projectId: string, secretName: string): string {
    return `${environment.openbaoAddr}/v1/secret/metadata/projects/${encodeURIComponent(projectId)}/${encodeURIComponent(secretName)}`;
  }

  private get authHeaders(): Record<string, string> {
    return {
      'X-Vault-Token': environment.openbaoToken,
      'Content-Type': 'application/json',
    };
  }

  private async request(
    url: string,
    options: RequestInit,
    errorCode: string,
    operationName: string,
  ): Promise<Response> {
    const response = await fetch(url, {
      ...options,
      headers: this.authHeaders,
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      this.logger.debug(`OpenBao ${operationName} error body: ${bodyText}`);
      throw new InternalException(
        errorCode,
        `OpenBao returned ${response.status} ${response.statusText}`,
      );
    }

    return response;
  }

  /**
   * Write a secret value to the KV v2 store at
   * `secret/data/projects/{projectId}/{secretName}`.
   */
  async putSecret(
    projectId: string,
    name: string,
    value: string,
  ): Promise<void> {
    this.assertAvailable();
    await this.request(
      this.buildDataPath(projectId, name),
      { method: 'PUT', body: JSON.stringify({ data: { value } }) },
      'SECRETS_STORE_PUT_FAILED',
      'putSecret',
    );
  }

  /**
   * Read a secret value from the KV v2 store at
   * `secret/data/projects/{projectId}/{secretName}`.
   * Returns the stored string value.
   */
  async getSecret(projectId: string, name: string): Promise<string> {
    this.assertAvailable();
    const response = await this.request(
      this.buildDataPath(projectId, name),
      { method: 'GET' },
      'SECRETS_STORE_GET_FAILED',
      'getSecret',
    );
    const body = (await response.json()) as unknown;
    const value =
      body != null &&
      typeof body === 'object' &&
      'data' in body &&
      body.data != null &&
      typeof body.data === 'object' &&
      'data' in body.data &&
      body.data.data != null &&
      typeof body.data.data === 'object' &&
      'value' in body.data.data
        ? (body.data.data as Record<string, unknown>)['value']
        : undefined;
    if (typeof value !== 'string') {
      throw new InternalException(
        'SECRETS_STORE_GET_FAILED',
        `Unexpected response from OpenBao for secret "${name}"`,
      );
    }
    return value;
  }

  /**
   * Delete a secret by removing its KV v2 metadata at
   * `secret/metadata/projects/{projectId}/{secretName}`.
   * Deleting metadata removes all versions of the secret.
   */
  async deleteSecret(projectId: string, name: string): Promise<void> {
    this.assertAvailable();
    await this.request(
      this.buildMetadataPath(projectId, name),
      { method: 'DELETE' },
      'SECRETS_STORE_DELETE_FAILED',
      'deleteSecret',
    );
  }
}
