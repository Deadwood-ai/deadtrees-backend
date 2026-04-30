import { IDataset } from "../types/dataset";

type PredictionCompletionState = Partial<
  Pick<IDataset, "is_deadwood_done" | "is_forest_cover_done" | "is_combined_model_done">
>;

export function hasDeadwoodPredictionOutput(dataset: PredictionCompletionState | null | undefined): boolean {
  return !!(dataset?.is_deadwood_done || dataset?.is_combined_model_done);
}

export function hasForestCoverPredictionOutput(dataset: PredictionCompletionState | null | undefined): boolean {
  return !!(dataset?.is_forest_cover_done || dataset?.is_combined_model_done);
}
