import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// --- Link Installation ---

export const LinkInstallationResponseSchema = z.object({
  linked: z
    .boolean()
    .describe('Whether the installation was successfully linked'),
  accountLogin: z
    .string()
    .describe('GitHub org/user login where the app is installed'),
  accountType: z.string().describe('Account type: Organization or User'),
});

// --- List Installations ---

export const InstallationRecordSchema = z.object({
  id: z.uuid().describe('Installation record ID'),
  installationId: z.number().int().describe('GitHub installation ID'),
  accountLogin: z.string().describe('GitHub org/user login'),
  accountType: z.string().describe('Account type: Organization or User'),
  isActive: z.boolean().describe('Whether the installation is active'),
  createdAt: z.iso.datetime(),
});

export const ListInstallationsResponseSchema = z.object({
  installations: z.array(InstallationRecordSchema),
});

// --- Unlink Installation ---

export const UnlinkInstallationResponseSchema = z.object({
  unlinked: z
    .boolean()
    .describe('Whether the installation was successfully unlinked'),
});

// Type exports
export type LinkInstallationResponse = z.infer<
  typeof LinkInstallationResponseSchema
>;
export type ListInstallationsResponse = z.infer<
  typeof ListInstallationsResponseSchema
>;
export type UnlinkInstallationResponse = z.infer<
  typeof UnlinkInstallationResponseSchema
>;

// DTOs
export class LinkInstallationResponseDto extends createZodDto(
  LinkInstallationResponseSchema,
) {}
export class ListInstallationsResponseDto extends createZodDto(
  ListInstallationsResponseSchema,
) {}
export class UnlinkInstallationResponseDto extends createZodDto(
  UnlinkInstallationResponseSchema,
) {}

// --- OAuth Link ---

export const OAuthLinkRequestSchema = z.object({
  code: z.string().min(1).describe('GitHub OAuth authorization code'),
  installationId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Optional GitHub App installation ID hint — used when the user was redirected from a GitHub App install flow',
    ),
});

export class OAuthLinkRequestDto extends createZodDto(OAuthLinkRequestSchema) {}

// --- Setup Info ---

export const SetupInfoResponseSchema = z.object({
  installUrl: z
    .string()
    .describe('URL to redirect the user to for GitHub App installation'),
  newInstallationUrl: z
    .string()
    .describe('URL to install the GitHub App on a new organization'),
  configured: z
    .boolean()
    .describe('Whether the GitHub App is fully configured'),
  callbackPath: z
    .string()
    .describe(
      'Path the user must set as "Setup URL" in their GitHub App settings (append to their domain)',
    ),
});

export type SetupInfoResponse = z.infer<typeof SetupInfoResponseSchema>;

export class SetupInfoResponseDto extends createZodDto(
  SetupInfoResponseSchema,
) {}
