export type AgentAssignment = {
  holdout: boolean;
  source: "server" | "server_setting" | "agent";
  percent: number;
  version: number;
};
export function holdoutBucket(shop: string, visitorId: string): number {
  let hash = 2166136261;
  const value = `${shop}\0${visitorId}`;
  for (let index = 0; index < value.length; index++)
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return (hash >>> 0) % 100;
}
function percentage(value: unknown): number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 100
    ? value
    : 0;
}
export class Holdout {
  private bucket: number;
  private override?: boolean;
  constructor(
    shop: string,
    visitorId: string,
    private options: {
      measurement: () => unknown;
      serverHoldout: () => boolean;
      percent: () => unknown;
      analytics: () => boolean;
    },
  ) {
    this.bucket = holdoutBucket(shop, visitorId);
  }
  setServerHoldout(value: boolean): void {
    this.override = value;
  }
  sync(): void {
    this.override = undefined;
  }
  current(): AgentAssignment {
    try {
      const raw = this.options.measurement() as Record<string, unknown> | null;
      if (
        raw &&
        ["exposed", "holdout"].includes(String(raw.arm)) &&
        Number.isSafeInteger(raw.version) &&
        Number(raw.version) > 0 &&
        typeof raw.link === "string" &&
        raw.link.length > 0 &&
        raw.link.length <= 512
      ) {
        return {
          holdout: raw.arm === "holdout",
          source: "server",
          version: Number(raw.version),
          percent: percentage(raw.percent),
        };
      }
      if (this.override ?? this.options.serverHoldout())
        return {
          holdout: true,
          source: "server_setting",
          version: 1,
          percent: 0,
        };
      const percent = this.options.analytics()
        ? percentage(this.options.percent())
        : 0;
      return {
        holdout: this.bucket < percent,
        source: "agent",
        version: 1,
        percent,
      };
    } catch {
      return {
        holdout: true,
        source: "server_setting",
        version: 1,
        percent: 0,
      };
    }
  }
}
