import { Settings } from "../../config";
import { priwaSupabase } from "../../hooks/usePriwaSupabase";
import { supabase } from "../../hooks/useSupabase";
import {
  PREVIEW_MAX_ROWS,
  PREVIEW_PAGE_SIZE,
  PRIWA_PREVIEW_DATASET_IDS,
} from "./constants";
import {
  assignOrthoControlArea,
  bboxTextToGeometry,
  sortControlAreas,
} from "./geometry";
import type {
  ControlAreaRow,
  DroneHintRow,
  ObservationRow,
  OrthoRow,
  PathRow,
  PreviewRow,
  PriwaData,
  WarningPolygonRow,
} from "./types";

const isMissingTableError = (message: string) =>
  message.includes("does not exist") ||
  message.includes("Could not find the table");

export const fetchPreviewDatasetOrthos = async (
  controlAreas: ControlAreaRow[],
) => {
  const { data, error } = await supabase
    .from(Settings.DATA_TABLE_FULL)
    .select(
      "id,file_name,project_id,user_id,bbox,cog_path,cog_file_size,aquisition_year,aquisition_month,aquisition_day,is_cog_done",
    )
    .in("id", [...PRIWA_PREVIEW_DATASET_IDS])
    .eq("is_cog_done", true)
    .not("bbox", "is", null)
    .not("cog_path", "is", null);

  if (error) {
    throw error;
  }
  if (!data?.length) {
    throw new Error("Keine PRIWA-Orthos in deadtrees gefunden");
  }

  return (data as Omit<OrthoRow, "geometry">[])
    .map((row) => ({
      ...row,
      geometry: bboxTextToGeometry(row.bbox),
    }))
    .filter((row): row is OrthoRow => !!row.geometry)
    .map((row) => assignOrthoControlArea(row, controlAreas));
};

export const fetchDeadwoodPredictionLabelIds = async () => {
  const { data, error } = await supabase
    .from(Settings.LABELS_TABLE)
    .select("id,dataset_id")
    .in("dataset_id", [...PRIWA_PREVIEW_DATASET_IDS])
    .eq("label_data", "deadwood")
    .eq("label_source", "model_prediction")
    .eq("is_active", true);

  if (error) {
    throw error;
  }

  return Object.fromEntries(
    (data ?? []).map((row) => [Number(row.dataset_id), Number(row.id)]),
  ) as Record<number, number>;
};

export async function fetchPriwaData(): Promise<{
  data: PriwaData;
  warnings: string[];
}> {
  const client = priwaSupabase;
  if (!client) {
    throw new Error(
      "PRIWA Supabase ist nicht konfiguriert. VITE_PRIWA_SUPABASE_URL und VITE_PRIWA_SUPABASE_ANON_KEY fehlen.",
    );
  }

  const fetchPreviewRows = async <TRow extends PreviewRow>(
    tableName: string,
    options: { maxRows?: number; orderBy?: string; pageSize?: number } = {},
  ) => {
    const pageSize = options.pageSize ?? PREVIEW_PAGE_SIZE;
    const maxRows = options.maxRows ?? PREVIEW_MAX_ROWS;
    const rows: TRow[] = [];

    for (let from = 0; from < maxRows; from += pageSize) {
      const to = Math.min(from + pageSize - 1, maxRows - 1);
      let query = client.from(tableName).select("*");

      if (options.orderBy) {
        query = query.order(options.orderBy);
      }

      const response = await query.range(from, to);

      if (response.error) {
        return { data: rows, error: response.error };
      }

      const page = (response.data ?? []) as TRow[];
      rows.push(...page);

      if (page.length < pageSize) {
        break;
      }
    }

    return { data: rows, error: null };
  };

  const warnings: string[] = [];
  const [controlAreas, observations, warningPolygons, droneHints, paths] =
    await Promise.all([
      fetchPreviewRows<ControlAreaRow>("priwa_preview_control_areas"),
      fetchPreviewRows<ObservationRow>("priwa_preview_observations"),
      fetchPreviewRows<WarningPolygonRow>("priwa_preview_warning_polygons"),
      fetchPreviewRows<DroneHintRow>("priwa_preview_drone_hints"),
      fetchPreviewRows<PathRow>("priwa_preview_paths"),
    ]);

  for (const [label, response] of [
    ["Kontrollflächen", controlAreas],
    ["Käferbäume", observations],
    ["Warnkarte", warningPolygons],
    ["Drohnenhinweise", droneHints],
    ["Wege", paths],
  ] as const) {
    if (response.error) {
      if (isMissingTableError(response.error.message)) {
        warnings.push(`${label}: Preview-View ist noch nicht verfügbar`);
        continue;
      }

      throw new Error(`${label}: ${response.error.message}`);
    }
  }

  return {
    data: {
      controlAreas: sortControlAreas(
        (controlAreas.data ?? []) as ControlAreaRow[],
      ),
      observations: (observations.data ?? []) as ObservationRow[],
      warningPolygons: (warningPolygons.data ?? []) as WarningPolygonRow[],
      droneHints: (droneHints.data ?? []) as DroneHintRow[],
      paths: (paths.data ?? []) as PathRow[],
      orthos: [],
    },
    warnings,
  };
}
