import { describe, expect, it } from "vitest";

import {
  hasDeadwoodPredictionOutput,
  hasForestCoverPredictionOutput,
} from "./predictionAvailability";

describe("prediction availability", () => {
  it("accepts legacy per-layer completion flags", () => {
    expect(hasDeadwoodPredictionOutput({ is_deadwood_done: true })).toBe(true);
    expect(hasForestCoverPredictionOutput({ is_forest_cover_done: true })).toBe(true);
  });

  it("accepts combined-model completion for both prediction layers", () => {
    const dataset = {
      is_deadwood_done: false,
      is_forest_cover_done: false,
      is_combined_model_done: true,
    };

    expect(hasDeadwoodPredictionOutput(dataset)).toBe(true);
    expect(hasForestCoverPredictionOutput(dataset)).toBe(true);
  });

  it("requires at least one completion signal", () => {
    const dataset = {
      is_deadwood_done: false,
      is_forest_cover_done: false,
      is_combined_model_done: false,
    };

    expect(hasDeadwoodPredictionOutput(dataset)).toBe(false);
    expect(hasForestCoverPredictionOutput(dataset)).toBe(false);
  });
});
