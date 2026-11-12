// Safe categories only: never log SDK errors, URLs, credentials or response bodies.
export function dependencyFailureReason(error: unknown): string {
  const value = error as {
    code?: unknown;
    message?: unknown;
    cause?: unknown;
  } | null;
  const code = String(value?.code || "");
  if (/^P202[12]$/.test(code)) return "schema_missing";
  if (/^(ENOTFOUND|EAI_AGAIN)$/.test(code)) return "dns_failure";
  const message = typeof value?.message === "string" ? value.message : "";
  if (/WRONGPASS|unauthorized|invalid.*token|authentication/i.test(message))
    return "authentication_failed";
  if (/quota|limit.*exceeded|max.*requests/i.test(message))
    return "quota_exceeded";
  if (/NOPERM|not allowed|unsupported|disabled/i.test(message))
    return "operation_not_permitted";
  if (
    /timeout|aborted/i.test(message) ||
    /^(P1001|P1002|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT)$/.test(code)
  )
    return "connection_timeout";
  if (value?.cause && value.cause !== error)
    return dependencyFailureReason(value.cause);
  return "unavailable";
}

const reportedAt = new Map<string, number>();
export function reportDependencyFailure(operation: string, error: unknown) {
  const reason = dependencyFailureReason(error);
  const key = `${operation}:${reason}`;
  const previous = reportedAt.get(key);
  if (previous !== undefined && Date.now() - previous < 60_000) return;
  if (reportedAt.size >= 100)
    reportedAt.delete(reportedAt.keys().next().value!);
  reportedAt.set(key, Date.now());
  console.error("AOVBoost dependency unavailable", { operation, reason });
}
