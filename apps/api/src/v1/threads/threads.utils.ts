/** Strip wait-related fields from thread metadata. */
export function clearWaitMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!metadata) {
    return {};
  }
  const {
    scheduledResumeAt,
    waitReason,
    waitNodeId,
    waitCheckPrompt,
    ...rest
  } = metadata;
  return rest;
}
