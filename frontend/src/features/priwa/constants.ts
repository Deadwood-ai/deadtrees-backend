import { mapColors } from "../../theme/mapColors";
import { palette } from "../../theme/palette";
import type { LayerVisibility, PreviewLayerKey, PriwaData } from "./types";

export const initialData: PriwaData = {
  controlAreas: [],
  observations: [],
  warningPolygons: [],
  droneHints: [],
  paths: [],
  orthos: [],
};

export const initialVisibility: LayerVisibility = {
  controlAreas: true,
  observations: true,
  warningPolygons: true,
  droneHints: true,
  paths: false,
  orthos: true,
};

export const DEFAULT_WAYBACK_RELEASE = 31144;

export const basemapOptions = [
  { value: "streets-v12", label: "Karte" },
  { value: "satellite-streets-v12", label: "Luftbild" },
];

export const layerVisuals: Record<
  PreviewLayerKey,
  { label: string; color: string; countLabel: string }
> = {
  controlAreas: {
    label: "Kontrollflächen",
    color: mapColors.aoi.stroke,
    countLabel: "areas",
  },
  observations: {
    label: "Käferbäume",
    color: mapColors.deadwood.fill,
    countLabel: "trees",
  },
  warningPolygons: {
    label: "Warnkarte",
    color: palette.state.error,
    countLabel: "polygons",
  },
  droneHints: {
    label: "Drohnenhinweise",
    color: "#2563eb",
    countLabel: "hints",
  },
  paths: {
    label: "Wege",
    color: palette.neutral[500],
    countLabel: "paths",
  },
  orthos: {
    label: "Orthos",
    color: palette.primary[600],
    countLabel: "cogs",
  },
};

export const PREVIEW_PAGE_SIZE = 1000;
export const PREVIEW_MAX_ROWS = 20000;
export const ORTHO_RASTER_LIMIT = 12;
export const ORTHO_RASTER_OPACITY = 0.88;
export const DEADWOOD_PREDICTION_OPACITY = 0.88;
export const SWIPE_CSS_VAR = "--priwa-swipe-position";
export const PRIWA_PREVIEW_DATASET_IDS = [6003, 8298, 9672] as const;
export const PRIWA_COMPARE_CONTROL_AREA_ID =
  "26d9d2d0-8298-4672-8000-000000000002";
export const PRIWA_COMPARE_DATASET_IDS = {
  previous: 8298,
  current: 9672,
} as const;
