export type HoldoutMeasurement = {
  arm: "exposed" | "holdout";
  version: number;
  percent: number;
  link: string;
};
export const MEASUREMENT_ATTRIBUTE = "__aovboost_measurement__";
