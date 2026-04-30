import { describe, expect, it } from "vitest";

import { hasForestCoverPredictionOutput } from "./predictionAvailability";

describe("prediction availability", () => {
  it("accepts the legacy forest-cover completion flag", () => {
    expect(hasForestCoverPredictionOutput({ is_forest_cover_done: true })).toBe(true);
  });

  it("accepts combined-model completion for forest-cover prediction output", () => {
    const dataset = {
      is_forest_cover_done: false,
      is_combined_model_done: true,
    };

    expect(hasForestCoverPredictionOutput(dataset)).toBe(true);
  });

  it("requires a forest-cover or combined-model completion signal", () => {
    const dataset = {
      is_forest_cover_done: false,
      is_combined_model_done: false,
    };

    expect(hasForestCoverPredictionOutput(dataset)).toBe(false);
  });
});
