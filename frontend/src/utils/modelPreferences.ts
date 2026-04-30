import { ILabel, ILabelData, ILabelSource } from "../types/labels";

export type ModelConfig = Record<string, unknown>;

export const COMBINED_MODEL_CONFIG: ModelConfig = {
  module: "deadwood_treecover_combined_v2",
  checkpoint_name: "mitb3_seed200_ckpt_epoch_6_best_macro_f1.safetensors",
};

export const DEFAULT_MODEL_PREFERENCES: Record<ILabelData, ModelConfig> = {
  [ILabelData.DEADWOOD]: COMBINED_MODEL_CONFIG,
  [ILabelData.FOREST_COVER]: COMBINED_MODEL_CONFIG,
};

function configMatches(
  labelConfig: ModelConfig | undefined,
  preferredConfig: ModelConfig,
): boolean {
  if (!labelConfig) return false;
  return Object.entries(preferredConfig).every(
    ([key, value]) => labelConfig[key] === value,
  );
}

export function selectPreferredModelLabel<
  T extends Pick<ILabel, "label_source" | "model_config" | "is_active">,
>(
  labels: T[],
  labelType: ILabelData,
  preferences?: ReadonlyMap<string, ModelConfig>,
): T | null {
  const activeLabels = labels.filter((label) => label.is_active !== false);
  if (activeLabels.length === 0) return null;
  if (activeLabels.length === 1) return activeLabels[0];

  const preferredConfig =
    preferences?.get(labelType) ?? DEFAULT_MODEL_PREFERENCES[labelType];
  const preferred = activeLabels.find(
    (label) =>
      label.label_source === ILabelSource.MODEL_PREDICTION &&
      configMatches(label.model_config, preferredConfig),
  );

  if (preferred) return preferred;

  return (
    activeLabels.find(
      (label) => label.label_source === ILabelSource.MODEL_PREDICTION,
    ) ?? activeLabels[0]
  );
}
