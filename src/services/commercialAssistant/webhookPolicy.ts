export function providerTimestamp(value?: string) {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = new Date(Number(value) * 1000);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

export function isOutOfOrderMessage(
  current: Date | null | undefined,
  latestCompleted: Date | null | undefined
) {
  return Boolean(
    current &&
    latestCompleted &&
    current.getTime() < latestCompleted.getTime()
  );
}

export function safeProcessingError(error: unknown) {
  const value = error instanceof Error ? error.message : String(error);
  return value.replace(/\+?\d[\d\s()-]{7,}\d/g, '[phone]').slice(0, 1000);
}
