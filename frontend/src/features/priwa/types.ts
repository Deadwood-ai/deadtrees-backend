import type { Geometry as GeoJsonGeometry } from "geojson";

export type PreviewLayerKey =
  | "controlAreas"
  | "observations"
  | "warningPolygons"
  | "droneHints"
  | "paths"
  | "orthos";

export type LayerVisibility = Record<PreviewLayerKey, boolean>;
export type PriwaMapStyle = "streets-v12" | "satellite-streets-v12";
export type PriwaReleaseStatus = "in_review" | "accepted";

export type PreviewRow = {
  id: string | number;
  control_area_id?: string | null;
  geometry: GeoJsonGeometry | null;
};

export type ControlAreaRow = PreviewRow & {
  id: string;
  name: string;
  slug: string;
  status: string;
  qfieldcloud_project_name?: string | null;
  owner_org?: string | null;
  spotter_team?: string | null;
  target_gsd_cm?: number | null;
  mobile_storage_budget_mb?: number | null;
  updated_at?: string | null;
};

export type ObservationRow = PreviewRow & {
  id: string;
  observed_at?: string | null;
  tree_species?: string | null;
  attack_status?: string | null;
  comment?: string | null;
  verification_status?: string | null;
  raw_attributes?: Record<string, unknown> | null;
};

export type WarningPolygonRow = PreviewRow & {
  id: string;
  probability?: number | null;
  raw_attributes?: Record<string, unknown> | null;
};

export type DroneHintRow = PreviewRow & {
  id: string;
  source_feature_id?: number | null;
  raw_attributes?: Record<string, unknown> | null;
};

export type PathRow = PreviewRow & {
  id: string;
  name?: string | null;
  path_type?: string | null;
};

export type OrthoRow = {
  id: number;
  file_name: string | null;
  project_id: string | null;
  user_id: string | null;
  bbox: string | null;
  cog_path: string | null;
  cog_file_size?: number | null;
  aquisition_year?: string | number | null;
  aquisition_month?: string | number | null;
  aquisition_day?: string | number | null;
  geometry: GeoJsonGeometry | null;
  control_area_id?: string | null;
  preview_role?: "single" | "previous" | "current";
};

export type PriwaData = {
  controlAreas: ControlAreaRow[];
  observations: ObservationRow[];
  warningPolygons: WarningPolygonRow[];
  droneHints: DroneHintRow[];
  paths: PathRow[];
  orthos: OrthoRow[];
};
