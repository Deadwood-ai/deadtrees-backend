import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Divider,
  Empty,
  Segmented,
  Slider,
  Skeleton,
  Tag,
  Tooltip,
} from "antd";
import {
  AimOutlined,
  CheckCircleOutlined,
  CloudSyncOutlined,
  InfoCircleOutlined,
} from "@ant-design/icons";
import type { Geometry as GeoJsonGeometry } from "geojson";
import Feature from "ol/Feature";
import type { FeatureLike } from "ol/Feature";
import GeoJSON from "ol/format/GeoJSON";
import type { Geometry } from "ol/geom";
import { createEmpty, extend } from "ol/extent";
import Map from "ol/Map";
import View from "ol/View";
import { defaults as defaultInteractions } from "ol/interaction";
import Draw, { DrawEvent } from "ol/interaction/Draw";
import TileLayerWebGL from "ol/layer/WebGLTile.js";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { GeoTIFF } from "ol/source";
import { Fill, Stroke, Style, Circle as CircleStyle } from "ol/style";
import { booleanIntersects } from "@turf/turf";
import "ol/ol.css";

import { createDeadwoodVectorLayer } from "../components/DatasetDetailsMap/createVectorLayer";
import {
  isPriwaSupabaseConfigured,
  priwaSupabase,
} from "../hooks/usePriwaSupabase";
import { supabase } from "../hooks/useSupabase";
import { Settings } from "../config";
import {
  createOpenFreeMapLibertyLayerGroup,
  createWaybackSource,
  createWaybackTileLayer,
} from "../utils/basemaps";
import { mapColors } from "../theme/mapColors";
import { palette } from "../theme/palette";

type PreviewLayerKey =
  | "controlAreas"
  | "observations"
  | "warningPolygons"
  | "droneHints"
  | "paths"
  | "orthos";

type LayerVisibility = Record<PreviewLayerKey, boolean>;
type PriwaMapStyle = "streets-v12" | "satellite-streets-v12";
type PriwaReleaseStatus = "in_review" | "accepted";

type PreviewRow = {
  id: string | number;
  control_area_id?: string | null;
  geometry: GeoJsonGeometry | null;
};

type ControlAreaRow = PreviewRow & {
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

type ObservationRow = PreviewRow & {
  id: string;
  observed_at?: string | null;
  tree_species?: string | null;
  attack_status?: string | null;
  comment?: string | null;
  verification_status?: string | null;
  raw_attributes?: Record<string, unknown> | null;
};

type WarningPolygonRow = PreviewRow & {
  id: string;
  probability?: number | null;
  raw_attributes?: Record<string, unknown> | null;
};

type DroneHintRow = PreviewRow & {
  id: string;
  source_feature_id?: number | null;
  raw_attributes?: Record<string, unknown> | null;
};

type PathRow = PreviewRow & {
  id: string;
  name?: string | null;
  path_type?: string | null;
};

type OrthoRow = {
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

type PriwaData = {
  controlAreas: ControlAreaRow[];
  observations: ObservationRow[];
  warningPolygons: WarningPolygonRow[];
  droneHints: DroneHintRow[];
  paths: PathRow[];
  orthos: OrthoRow[];
};

const initialData: PriwaData = {
  controlAreas: [],
  observations: [],
  warningPolygons: [],
  droneHints: [],
  paths: [],
  orthos: [],
};

const initialVisibility: LayerVisibility = {
  controlAreas: true,
  observations: true,
  warningPolygons: true,
  droneHints: true,
  paths: false,
  orthos: true,
};

const geoJsonFormat = new GeoJSON();
const DEFAULT_WAYBACK_RELEASE = 31144;

const basemapOptions = [
  { value: "streets-v12", label: "Karte" },
  { value: "satellite-streets-v12", label: "Luftbild" },
];

const layerVisuals: Record<
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

const createFeatures = <TRow extends PreviewRow>(
  rows: TRow[],
  layerName: string,
): Feature<Geometry>[] =>
  rows
    .filter((row) => row.geometry)
    .map((row) => {
      const { geometry, ...properties } = row;
      const feature = geoJsonFormat.readFeature(
        {
          type: "Feature",
          geometry,
          properties: { ...properties, layerName },
        },
        { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" },
      ) as Feature<Geometry>;

      feature.setId(row.id);
      return feature;
    });

const controlAreaStyle = new Style({
  fill: new Fill({ color: "rgba(0, 0, 0, 0)" }),
  stroke: new Stroke({ color: mapColors.aoi.stroke, width: 2.5 }),
});

const interpolateColor = (
  low: [number, number, number],
  high: [number, number, number],
  value: number,
) =>
  low.map((channel, index) =>
    Math.round(channel + (high[index] - channel) * value),
  ) as [number, number, number];

const normalizeWarningProbability = (value: unknown) => {
  const probability = Number(value);
  if (!Number.isFinite(probability)) return 0.35;
  return Math.max(
    0,
    Math.min(1, probability > 1 ? probability / 100 : probability),
  );
};

const warningStyleCache = new globalThis.Map<number, Style>();

const warningStyle = (feature: FeatureLike) => {
  const rawAttributes = feature.get("raw_attributes") as
    | Record<string, unknown>
    | undefined;
  const probability = normalizeWarningProbability(
    feature.get("probability") ?? rawAttributes?.probability,
  );
  const bucket = Math.round(probability * 10);
  const cachedStyle = warningStyleCache.get(bucket);
  if (cachedStyle) return cachedStyle;

  const bucketProbability = bucket / 10;
  const [red, green, blue] = interpolateColor(
    [255, 0, 0],
    [128, 0, 0],
    bucketProbability,
  );
  const alpha = 0.72 + bucketProbability * 0.2;
  const style = new Style({
    fill: new Fill({ color: `rgba(${red}, ${green}, ${blue}, ${alpha})` }),
  });
  warningStyleCache.set(bucket, style);
  return style;
};

const observationStyle = new Style({
  image: new CircleStyle({
    radius: 6,
    fill: new Fill({ color: mapColors.deadwood.fill }),
    stroke: new Stroke({ color: "#ffffff", width: 2 }),
  }),
});

const pathStyle = new Style({
  stroke: new Stroke({ color: "rgba(107, 114, 128, 0.72)", width: 1.5 }),
});

const orthoFootprintStyle = new Style({
  fill: new Fill({ color: "rgba(27, 94, 53, 0.08)" }),
  stroke: new Stroke({ color: palette.primary[600], width: 1.8 }),
});

const droneHintStyle = (feature: FeatureLike) => {
  const selected = Boolean(feature.get("selected"));

  return new Style({
    fill: new Fill({
      color: selected ? "rgba(37, 99, 235, 0.12)" : "rgba(37, 99, 235, 0)",
    }),
    stroke: new Stroke({
      color: selected ? "#1d4ed8" : "#2563eb",
      width: selected ? 4 : 3,
    }),
  });
};

const isMissingTableError = (message: string) =>
  message.includes("does not exist") ||
  message.includes("Could not find the table");

const PREVIEW_PAGE_SIZE = 1000;
const PREVIEW_MAX_ROWS = 20000;
const ORTHO_RASTER_LIMIT = 12;
const ORTHO_RASTER_OPACITY = 0.88;
const DEADWOOD_PREDICTION_OPACITY = 0.88;
const SWIPE_CSS_VAR = "--priwa-swipe-position";
const PRIWA_PREVIEW_DATASET_IDS = [6003, 8298, 9672] as const;
const PRIWA_COMPARE_CONTROL_AREA_ID = "26d9d2d0-8298-4672-8000-000000000002";
const PRIWA_COMPARE_DATASET_IDS = {
  previous: 8298,
  current: 9672,
} as const;

const parseBBox = (value: string | null) => {
  if (!value) return null;
  const match = value.match(
    /BOX\((-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)\)/,
  );
  if (!match) return null;
  const [minLon, minLat, maxLon, maxLat] = match.slice(1).map(Number);
  return { minLon, minLat, maxLon, maxLat };
};

const bboxToGeometry = (
  bbox: ReturnType<typeof parseBBox>,
): GeoJsonGeometry | null => {
  if (!bbox) return null;
  return {
    type: "Polygon",
    coordinates: [
      [
        [bbox.minLon, bbox.minLat],
        [bbox.maxLon, bbox.minLat],
        [bbox.maxLon, bbox.maxLat],
        [bbox.minLon, bbox.maxLat],
        [bbox.minLon, bbox.minLat],
      ],
    ],
  };
};

const intersectsControlArea = <TRow extends PreviewRow>(
  row: TRow,
  controlArea: ControlAreaRow,
) => {
  if (!row.geometry || !controlArea.geometry) return false;

  return booleanIntersects(
    {
      type: "Feature",
      geometry: row.geometry,
      properties: {},
    },
    {
      type: "Feature",
      geometry: controlArea.geometry,
      properties: {},
    },
  );
};

const sortControlAreas = (areas: ControlAreaRow[]) =>
  [...areas].sort((left, right) => {
    if (left.id === PRIWA_COMPARE_CONTROL_AREA_ID) return -1;
    if (right.id === PRIWA_COMPARE_CONTROL_AREA_ID) return 1;
    return left.name.localeCompare(right.name, "de");
  });

const getOrthoDate = (row: OrthoRow | null | undefined) => {
  if (!row) return "nicht verfügbar";
  const year = Number(row.aquisition_year);
  const month = Number(row.aquisition_month);
  const day = Number(row.aquisition_day);
  if (!year || !month || !day) return `Dataset ${row.id}`;

  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day)));
};

const getFlightName = (row: OrthoRow | null | undefined) =>
  row ? `Befliegung ${getOrthoDate(row)}` : "Befliegung nicht verfügbar";

const compactOrthos = (rows: Array<OrthoRow | null | undefined>): OrthoRow[] =>
  rows.filter((row): row is OrthoRow => !!row);

const getSwipeClip = (position: number) => `inset(0 0 0 ${position}%)`;

const applySwipePosition = (
  map: Map,
  isCompareMode: boolean,
  swipePosition: number,
) => {
  const viewport = map.getViewport();
  viewport.style.setProperty(SWIPE_CSS_VAR, `${swipePosition}%`);
  viewport.classList.toggle("priwa-swipe-enabled", isCompareMode);

  viewport
    .querySelectorAll<HTMLElement>(".priwa-swipe-current")
    .forEach((element) => {
      element.style.clipPath = isCompareMode ? getSwipeClip(swipePosition) : "";
      element.style.webkitClipPath = element.style.clipPath;
    });
};

const assignOrthoControlArea = (
  ortho: OrthoRow,
  controlAreas: ControlAreaRow[],
) => {
  const matchingArea = controlAreas.find((area) =>
    intersectsControlArea(ortho, area),
  );

  return {
    ...ortho,
    control_area_id: matchingArea?.id ?? null,
    preview_role:
      ortho.id === PRIWA_COMPARE_DATASET_IDS.previous
        ? "previous"
        : ortho.id === PRIWA_COMPARE_DATASET_IDS.current
          ? "current"
          : "single",
  } satisfies OrthoRow;
};

const fetchPreviewDatasetOrthos = async (controlAreas: ControlAreaRow[]) => {
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
      geometry: bboxToGeometry(parseBBox(row.bbox)),
    }))
    .filter((row): row is OrthoRow => !!row.geometry)
    .map((row) => assignOrthoControlArea(row, controlAreas));
};

const fetchDeadwoodPredictionLabelIds = async () => {
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

async function fetchPriwaData(): Promise<{
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

const LayerToggle = ({
  checked,
  count,
  color,
  disabled = false,
  label,
  onChange,
  statusText,
}: {
  checked: boolean;
  count?: number;
  color: string;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
  statusText?: string;
}) => (
  <div className="flex min-h-7 items-center justify-between gap-2">
    <Checkbox
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    >
      <span
        className={`flex items-center gap-2 ${disabled ? "opacity-50" : ""}`}
      >
        <span
          className="h-3 w-3 rounded-sm"
          style={{ backgroundColor: color }}
        />
        <span className="text-xs text-gray-600">{label}</span>
      </span>
    </Checkbox>
    <span className="shrink-0 text-xs text-gray-400">
      {statusText ??
        (typeof count === "number" ? count.toLocaleString("de-DE") : null)}
    </span>
  </div>
);

const Priwa = () => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const streetBasemapRef = useRef<ReturnType<
    typeof createOpenFreeMapLibertyLayerGroup
  > | null>(null);
  const imageryBasemapRef = useRef<ReturnType<
    typeof createWaybackTileLayer
  > | null>(null);
  const orthoRasterLayerRefs = useRef<TileLayerWebGL[]>([]);
  const drawHintInteractionRef = useRef<Draw | null>(null);
  const deadwoodPredictionLayerRef = useRef<ReturnType<
    typeof createDeadwoodVectorLayer
  > | null>(null);
  const deadwoodPredictionVisibleRef = useRef(true);
  const swipePositionRef = useRef(50);
  const layerRefs = useRef<
    Record<PreviewLayerKey, VectorLayer<VectorSource<Feature<Geometry>>> | null>
  >({
    controlAreas: null,
    observations: null,
    warningPolygons: null,
    droneHints: null,
    paths: null,
    orthos: null,
  });

  const [data, setData] = useState<PriwaData>(initialData);
  const [visibility, setVisibility] =
    useState<LayerVisibility>(initialVisibility);
  const [deadwoodPredictionVisible, setDeadwoodPredictionVisible] =
    useState(true);
  const [deadwoodPredictionLabelIds, setDeadwoodPredictionLabelIds] = useState<
    Record<number, number>
  >({});
  const [mapStyle, setMapStyle] = useState<PriwaMapStyle>("streets-v12");
  const [releaseStatus, setReleaseStatus] =
    useState<PriwaReleaseStatus>("in_review");
  const [swipePosition, setSwipePosition] = useState(50);
  const [selectedControlAreaId, setSelectedControlAreaId] = useState<
    string | null
  >(null);
  const [selectedDroneHintId, setSelectedDroneHintId] = useState<string | null>(
    null,
  );
  const [editingDroneHintId, setEditingDroneHintId] = useState<string | null>(
    null,
  );
  const [isDrawingHint, setIsDrawingHint] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const selectedControlArea = useMemo(
    () =>
      data.controlAreas.find((area) => area.id === selectedControlAreaId) ??
      data.controlAreas[0] ??
      null,
    [data.controlAreas, selectedControlAreaId],
  );

  const visibleData = useMemo(() => {
    if (!selectedControlArea) return initialData;

    return {
      controlAreas: [selectedControlArea],
      observations: data.observations.filter((row) =>
        intersectsControlArea(row, selectedControlArea),
      ),
      warningPolygons: data.warningPolygons.filter((row) =>
        intersectsControlArea(row, selectedControlArea),
      ),
      droneHints: data.droneHints.filter(
        (row) =>
          row.control_area_id === selectedControlArea.id ||
          intersectsControlArea(row, selectedControlArea),
      ),
      paths: data.paths.filter((row) =>
        intersectsControlArea(row, selectedControlArea),
      ),
      orthos: data.orthos.filter(
        (row) => row.control_area_id === selectedControlArea.id,
      ),
    } satisfies PriwaData;
  }, [data, selectedControlArea]);

  const previousOrtho = useMemo(
    () =>
      visibleData.orthos.find((row) => row.preview_role === "previous") ?? null,
    [visibleData.orthos],
  );
  const currentOrtho = useMemo(
    () =>
      visibleData.orthos.find((row) => row.preview_role === "current") ??
      visibleData.orthos.find((row) => row.preview_role === "single") ??
      visibleData.orthos[0] ??
      null,
    [visibleData.orthos],
  );
  const isCompareAvailable = !!previousOrtho && !!currentOrtho;
  const isCompareMode = isCompareAvailable;
  const renderedOrthos = useMemo(() => {
    if (isCompareMode) return compactOrthos([previousOrtho, currentOrtho]);
    return compactOrthos([currentOrtho ?? previousOrtho]);
  }, [currentOrtho, isCompareMode, previousOrtho]);
  const selectedPredictionLabelId = currentOrtho
    ? (deadwoodPredictionLabelIds[currentOrtho.id] ?? null)
    : null;

  const qfieldProjectName =
    selectedControlArea?.qfieldcloud_project_name ?? "kein QFieldCloud-Projekt";
  const currentFlightName = getFlightName(currentOrtho);
  const previousFlightName = getFlightName(previousOrtho);
  const fieldPackageStatus =
    releaseStatus === "accepted"
      ? "wartet auf Prozessor"
      : "wartet auf Freigabe";

  const fitToLiveData = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    const extent = createEmpty();
    let hasExtent = false;

    for (const layer of Object.values(layerRefs.current)) {
      const source = layer?.getSource();
      if (!source || source.isEmpty()) continue;
      extend(extent, source.getExtent());
      hasExtent = true;
    }

    if (!hasExtent) return;

    map.getView().fit(extent, {
      padding: [96, 336, 112, 304],
      maxZoom: 16,
      duration: 400,
    });
  }, []);

  const fitControlArea = useCallback((area: ControlAreaRow | null) => {
    const map = mapRef.current;
    if (!map || !area?.geometry) return;

    const feature = geoJsonFormat.readFeature(
      {
        type: "Feature",
        geometry: area.geometry,
        properties: {},
      },
      { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" },
    ) as Feature<Geometry>;
    const geometry = feature.getGeometry();
    if (!geometry) return;

    map.getView().fit(geometry.getExtent(), {
      padding: [96, 336, 112, 304],
      maxZoom: 16,
      duration: 400,
    });
  }, []);

  const focusDroneHint = useCallback((hint: DroneHintRow) => {
    setSelectedDroneHintId(String(hint.id));

    const map = mapRef.current;
    const source = layerRefs.current.droneHints?.getSource();
    const feature = source?.getFeatureById(hint.id);
    if (!map || !feature) return;
    const geometry = feature.getGeometry();
    if (!geometry) return;

    map.getView().fit(geometry.getExtent(), {
      padding: [160, 360, 160, 304],
      maxZoom: 18,
      duration: 300,
    });
  }, []);

  const stopDrawingHint = useCallback(() => {
    const map = mapRef.current;
    if (map && drawHintInteractionRef.current) {
      map.removeInteraction(drawHintInteractionRef.current);
    }
    drawHintInteractionRef.current = null;
    setIsDrawingHint(false);
    setEditingDroneHintId(null);
  }, []);

  const startDrawingHint = useCallback(
    (hintToEdit?: DroneHintRow) => {
      const map = mapRef.current;
      const source = layerRefs.current.droneHints?.getSource();
      if (!map || !source || !selectedControlArea) return;

      stopDrawingHint();
      setVisibility((current) => ({ ...current, droneHints: true }));

      const targetHintId = hintToEdit ? String(hintToEdit.id) : null;
      if (targetHintId) {
        setSelectedDroneHintId(targetHintId);
      }
      setEditingDroneHintId(targetHintId);

      const draw = new Draw({
        source,
        type: "Polygon",
      });

      draw.on("drawend", (event: DrawEvent) => {
        const geometry = event.feature.getGeometry();
        if (!geometry) {
          stopDrawingHint();
          return;
        }

        const hintId = targetHintId ?? `local-drone-hint-${Date.now()}`;
        const nextFeatureId =
          hintToEdit?.source_feature_id ??
          Math.max(
            0,
            ...visibleData.droneHints.map((hint) =>
              Number(hint.source_feature_id ?? 0),
            ),
          ) + 1;
        const geoJsonGeometry = geoJsonFormat.writeGeometryObject(geometry, {
          dataProjection: "EPSG:4326",
          featureProjection: "EPSG:3857",
        }) as GeoJsonGeometry;
        const rawAttributes = {
          ...(hintToEdit?.raw_attributes ?? {}),
          preview_local: true,
          preview_updated: Boolean(targetHintId),
          status: "offen",
          text: targetHintId
            ? "Aktualisierter Drohnenhinweis"
            : "Neu gezeichneter Drohnenhinweis",
        };

        const existingFeature = targetHintId
          ? source.getFeatureById(targetHintId)
          : null;
        if (existingFeature && existingFeature !== event.feature) {
          source.removeFeature(existingFeature);
        }

        event.feature.setId(hintId);
        event.feature.setProperties({
          id: hintId,
          control_area_id: selectedControlArea.id,
          source_feature_id: nextFeatureId,
          raw_attributes: rawAttributes,
          layerName: "droneHints",
          selected: true,
        });

        const nextHint: DroneHintRow = {
          id: hintId,
          control_area_id: selectedControlArea.id,
          geometry: geoJsonGeometry,
          source_feature_id: nextFeatureId,
          raw_attributes: rawAttributes,
        };

        setData((current) => ({
          ...current,
          droneHints: targetHintId
            ? current.droneHints.map((hint) =>
                String(hint.id) === targetHintId ? nextHint : hint,
              )
            : [...current.droneHints, nextHint],
        }));
        setSelectedDroneHintId(hintId);
        stopDrawingHint();
      });

      map.addInteraction(draw);
      drawHintInteractionRef.current = draw;
      setIsDrawingHint(true);
    },
    [selectedControlArea, stopDrawingHint, visibleData.droneHints],
  );

  const deleteDroneHint = useCallback(
    (hint: DroneHintRow) => {
      const hintId = String(hint.id);
      setData((current) => ({
        ...current,
        droneHints: current.droneHints.filter(
          (currentHint) => String(currentHint.id) !== hintId,
        ),
      }));
      setSelectedDroneHintId((current) =>
        current === hintId ? null : current,
      );
      if (editingDroneHintId === hintId) {
        stopDrawingHint();
      }
    },
    [editingDroneHintId, stopDrawingHint],
  );

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const layers = {
      controlAreas: new VectorLayer({
        source: new VectorSource<Feature<Geometry>>(),
        style: controlAreaStyle,
        zIndex: 30,
      }),
      warningPolygons: new VectorLayer({
        source: new VectorSource<Feature<Geometry>>(),
        style: warningStyle,
        zIndex: 20,
      }),
      droneHints: new VectorLayer({
        source: new VectorSource<Feature<Geometry>>(),
        style: droneHintStyle,
        zIndex: 38,
      }),
      orthos: new VectorLayer({
        source: new VectorSource<Feature<Geometry>>(),
        style: orthoFootprintStyle,
        zIndex: 22,
      }),
      paths: new VectorLayer({
        source: new VectorSource<Feature<Geometry>>(),
        style: pathStyle,
        zIndex: 24,
      }),
      observations: new VectorLayer({
        source: new VectorSource<Feature<Geometry>>(),
        style: observationStyle,
        zIndex: 40,
      }),
    };

    layerRefs.current = layers;

    const streetBasemap = createOpenFreeMapLibertyLayerGroup();
    const imageryBasemap = createWaybackTileLayer(DEFAULT_WAYBACK_RELEASE);
    imageryBasemap.setVisible(false);
    streetBasemapRef.current = streetBasemap;
    imageryBasemapRef.current = imageryBasemap;

    const map = new Map({
      target: mapContainerRef.current,
      layers: [
        streetBasemap,
        imageryBasemap,
        layers.warningPolygons,
        layers.paths,
        layers.controlAreas,
        layers.droneHints,
        layers.observations,
      ],
      controls: [],
      interactions: defaultInteractions({
        doubleClickZoom: false,
        pinchRotate: false,
      }),
      view: new View({
        center: [920000, 6165000],
        zoom: 12,
      }),
    });

    mapRef.current = map;

    return () => {
      if (drawHintInteractionRef.current) {
        map.removeInteraction(drawHintInteractionRef.current);
        drawHintInteractionRef.current = null;
      }
      map.setTarget(undefined);
      imageryBasemap.getSource()?.dispose();
      for (const layer of orthoRasterLayerRefs.current) {
        layer.getSource()?.dispose();
        layer.dispose();
      }
      if (deadwoodPredictionLayerRef.current) {
        map.removeLayer(deadwoodPredictionLayerRef.current);
        deadwoodPredictionLayerRef.current = null;
      }
      orthoRasterLayerRefs.current = [];
      streetBasemapRef.current = null;
      imageryBasemapRef.current = null;
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    void fetchPriwaData()
      .then(async (result) => {
        const [orthos, predictionLabelIds] = await Promise.all([
          fetchPreviewDatasetOrthos(result.data.controlAreas),
          fetchDeadwoodPredictionLabelIds(),
        ]);
        const controlAreas = sortControlAreas(result.data.controlAreas);
        const preferredControlArea =
          controlAreas.find(
            (area) => area.id === PRIWA_COMPARE_CONTROL_AREA_ID,
          ) ??
          controlAreas[0] ??
          null;

        setData({
          ...result.data,
          controlAreas,
          orthos,
        });
        setWarnings(result.warnings);
        setDeadwoodPredictionLabelIds(predictionLabelIds);
        setSelectedControlAreaId(preferredControlArea?.id ?? null);
        fitControlArea(preferredControlArea);
        setError(null);
      })
      .catch((fetchError: Error) => {
        setError(fetchError.message);
      })
      .finally(() => setLoading(false));
  }, [fitControlArea]);

  useEffect(() => {
    layerRefs.current.controlAreas?.getSource()?.clear();
    layerRefs.current.controlAreas
      ?.getSource()
      ?.addFeatures(createFeatures(visibleData.controlAreas, "controlAreas"));

    layerRefs.current.observations?.getSource()?.clear();
    layerRefs.current.observations
      ?.getSource()
      ?.addFeatures(createFeatures(visibleData.observations, "observations"));

    layerRefs.current.warningPolygons?.getSource()?.clear();
    layerRefs.current.warningPolygons
      ?.getSource()
      ?.addFeatures(
        createFeatures(visibleData.warningPolygons, "warningPolygons"),
      );

    layerRefs.current.droneHints?.getSource()?.clear();
    layerRefs.current.droneHints
      ?.getSource()
      ?.addFeatures(createFeatures(visibleData.droneHints, "droneHints"));

    layerRefs.current.orthos?.getSource()?.clear();

    layerRefs.current.paths?.getSource()?.clear();
    layerRefs.current.paths
      ?.getSource()
      ?.addFeatures(createFeatures(visibleData.paths, "paths"));
  }, [visibleData]);

  useEffect(() => {
    layerRefs.current.droneHints
      ?.getSource()
      ?.getFeatures()
      .forEach((feature) => {
        feature.set(
          "selected",
          String(feature.getId()) === selectedDroneHintId,
        );
        feature.changed();
      });
  }, [selectedDroneHintId, visibleData.droneHints]);

  useEffect(() => {
    stopDrawingHint();
  }, [selectedControlAreaId, stopDrawingHint]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    for (const layer of orthoRasterLayerRefs.current) {
      map.removeLayer(layer);
      layer.getSource()?.dispose();
      layer.dispose();
    }
    applySwipePosition(map, isCompareMode, swipePositionRef.current);

    orthoRasterLayerRefs.current = renderedOrthos
      .filter((row) => row.cog_path)
      .slice(0, ORTHO_RASTER_LIMIT)
      .map((row, index) => {
        const isCurrentSwipeLayer =
          isCompareMode && row.id === currentOrtho?.id && index > 0;
        const layer = new TileLayerWebGL({
          className: isCurrentSwipeLayer
            ? "ol-layer priwa-swipe-current"
            : "ol-layer priwa-swipe-base",
          source: new GeoTIFF({
            sources: [
              {
                url: Settings.COG_BASE_URL + row.cog_path,
                nodata: 0,
                bands: [1, 2, 3],
              },
            ],
            convertToRGB: true,
          }),
          opacity: ORTHO_RASTER_OPACITY,
          visible: visibility.orthos,
          maxZoom: 23,
          cacheSize: 1024,
          preload: 0,
          zIndex: 18 + index,
        });

        map.addLayer(layer);
        return layer;
      });

    window.setTimeout(
      () => applySwipePosition(map, isCompareMode, swipePositionRef.current),
      0,
    );
    map.render();
  }, [currentOrtho?.id, isCompareMode, renderedOrthos, visibility.orthos]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (deadwoodPredictionLayerRef.current) {
      map.removeLayer(deadwoodPredictionLayerRef.current);
      deadwoodPredictionLayerRef.current = null;
    }

    if (!selectedPredictionLabelId) return;

    const layer = createDeadwoodVectorLayer(selectedPredictionLabelId);
    layer.setZIndex(42);
    layer.setOpacity(DEADWOOD_PREDICTION_OPACITY);
    layer.setVisible(deadwoodPredictionVisibleRef.current);
    map.addLayer(layer);
    deadwoodPredictionLayerRef.current = layer;
  }, [selectedPredictionLabelId]);

  useEffect(() => {
    for (const [key, isVisible] of Object.entries(visibility) as [
      PreviewLayerKey,
      boolean,
    ][]) {
      layerRefs.current[key]?.setVisible(isVisible);
    }
    for (const layer of orthoRasterLayerRefs.current) {
      layer.setVisible(visibility.orthos);
    }
  }, [visibility]);

  useEffect(() => {
    deadwoodPredictionVisibleRef.current = deadwoodPredictionVisible;
    deadwoodPredictionLayerRef.current?.setVisible(deadwoodPredictionVisible);
  }, [deadwoodPredictionVisible]);

  useEffect(() => {
    swipePositionRef.current = swipePosition;
    const map = mapRef.current;
    if (!map) return;

    applySwipePosition(map, isCompareMode, swipePosition);
    map.render();
  }, [isCompareMode, swipePosition]);

  useEffect(() => {
    const isImagery = mapStyle === "satellite-streets-v12";
    streetBasemapRef.current?.setVisible(!isImagery);
    imageryBasemapRef.current?.setVisible(isImagery);

    if (isImagery) {
      imageryBasemapRef.current?.setSource(
        createWaybackSource(DEFAULT_WAYBACK_RELEASE),
      );
    }
  }, [mapStyle]);

  const updateVisibility = (key: PreviewLayerKey, checked: boolean) => {
    setVisibility((current) => ({ ...current, [key]: checked }));
  };

  return (
    <div className="relative h-full min-h-screen overflow-hidden bg-slate-100">
      <style>
        {`
          .priwa-swipe-enabled .priwa-swipe-current {
            clip-path: inset(0 0 0 var(${SWIPE_CSS_VAR}, 50%));
            -webkit-clip-path: inset(0 0 0 var(${SWIPE_CSS_VAR}, 50%));
          }
        `}
      </style>
      <div ref={mapContainerRef} className="absolute inset-0" />

      {isCompareMode && (
        <>
          <div
            className="pointer-events-none absolute top-0 z-10 h-full w-px bg-white/90 shadow-[0_0_0_1px_rgba(31,41,55,0.35)]"
            style={{ left: `${swipePosition}%` }}
          />
          <div className="pointer-events-auto absolute bottom-5 left-4 right-4 z-30 rounded-lg border border-gray-200/80 bg-white/95 px-4 py-2 shadow-xl backdrop-blur-sm">
            <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-gray-700">
              <span>Alt · Dataset {previousOrtho?.id}</span>
              <span className="text-emerald-800">
                Neu · Dataset {currentOrtho?.id}
              </span>
            </div>
            <Slider
              min={0}
              max={100}
              step={1}
              value={swipePosition}
              onChange={setSwipePosition}
              tooltip={{ formatter: null }}
            />
          </div>
        </>
      )}

      {isDrawingHint && (
        <div className="pointer-events-none absolute left-1/2 top-24 z-30 w-[min(440px,calc(100vw-32px))] -translate-x-1/2 rounded-lg border border-blue-200 bg-blue-50/95 px-4 py-3 shadow-xl backdrop-blur-sm">
          <div className="flex items-start gap-3">
            <InfoCircleOutlined className="mt-0.5 text-lg text-blue-600" />
            <div>
              <p className="m-0 text-sm font-semibold text-gray-900">
                {editingDroneHintId
                  ? "Hinweis neu zeichnen"
                  : "Polygon zeichnen"}
              </p>
              <p className="m-0 mt-1 text-xs leading-5 text-gray-700">
                Punkte in die Karte klicken, mit Doppelklick abschließen.
              </p>
            </div>
          </div>
        </div>
      )}

      <aside className="pointer-events-auto absolute left-3 top-24 z-20 w-[260px] max-w-[calc(100vw-24px)] overflow-hidden rounded-lg border border-gray-200/70 bg-white/95 shadow-xl backdrop-blur-sm">
        <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-2">
          <h2 className="m-0 text-[10px] font-medium uppercase tracking-[0.08em] text-gray-500">
            Kontrollflächen
          </h2>
          <Button size="small" icon={<AimOutlined />} onClick={fitToLiveData}>
            Zoom
          </Button>
        </div>
        <div className="max-h-[calc(100vh-144px)] overflow-y-auto p-2">
          {loading ? (
            <Skeleton active paragraph={{ rows: 3 }} title={false} />
          ) : data.controlAreas.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="Keine Kontrollfläche sichtbar"
            />
          ) : (
            <div className="space-y-1.5">
              {data.controlAreas.map((area) => (
                <button
                  key={area.id}
                  type="button"
                  className={`w-full rounded-md border px-2 py-1.5 text-left transition ${
                    area.id === selectedControlArea?.id
                      ? "border-emerald-600 bg-emerald-50"
                      : "border-gray-200 bg-white hover:border-gray-300"
                  }`}
                  onClick={() => {
                    setSelectedControlAreaId(area.id);
                    fitControlArea(area);
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-semibold text-gray-900">
                      {area.name}
                    </span>
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        area.status === "active"
                          ? "bg-emerald-500"
                          : "bg-gray-300"
                      }`}
                    />
                  </div>
                  <p className="m-0 mt-0.5 truncate text-[11px] text-gray-500">
                    {area.qfieldcloud_project_name ??
                      "noch kein QFieldCloud-Projekt"}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>

      <aside className="pointer-events-auto absolute right-3 top-24 z-20 w-[280px] max-w-[calc(100vw-24px)] overflow-hidden rounded-lg border border-gray-200/70 bg-white/95 shadow-xl backdrop-blur-sm md:right-4">
        <div className="border-b border-gray-100 px-3 py-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-gray-500">
                PRIWA Monitoring
              </p>
              <h1 className="text-sm font-semibold text-gray-900">
                Spotter-Vorschau
              </h1>
            </div>
            <Tooltip title="Live-Vorschau aus PRIWA Supabase. Upload, Schreiben und Sync sind hier noch inaktiv.">
              <InfoCircleOutlined className="text-gray-400 hover:text-gray-600" />
            </Tooltip>
          </div>
        </div>

        <div className="max-h-[calc(100vh-144px)] overflow-y-auto px-3 py-3">
          {!isPriwaSupabaseConfigured && (
            <Alert
              type="warning"
              showIcon
              className="mb-3"
              message="PRIWA Supabase ist nicht konfiguriert"
              description="Set VITE_PRIWA_SUPABASE_URL and VITE_PRIWA_SUPABASE_ANON_KEY."
            />
          )}

          {error && (
            <Alert
              type="error"
              showIcon
              className="mb-3"
              message="PRIWA-Layer konnten nicht geladen werden"
              description={error}
            />
          )}

          {warnings.map((warning) => (
            <Alert
              key={warning}
              type="warning"
              showIcon
              className="mb-3"
              message={warning}
            />
          ))}

          {loading ? (
            <Skeleton active paragraph={{ rows: 8 }} />
          ) : (
            <>
              <section>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <h2 className="m-0 text-[10px] font-medium uppercase tracking-[0.08em] text-gray-500">
                    Prüfung
                  </h2>
                  <Tag
                    color={releaseStatus === "accepted" ? "green" : "gold"}
                    className="m-0 border-none text-[10px] font-medium uppercase"
                  >
                    {releaseStatus === "accepted"
                      ? "freigegeben"
                      : "in Prüfung"}
                  </Tag>
                </div>

                <div className="rounded-md border border-gray-100 bg-gray-50 px-2 py-2 text-[11px] text-gray-600">
                  <div className="grid grid-cols-[48px_1fr] gap-x-2 gap-y-1">
                    <span>Neu</span>
                    <span className="truncate font-medium text-gray-800">
                      {currentFlightName}
                    </span>
                    <span>Alt</span>
                    <span className="truncate font-medium text-gray-800">
                      {previousFlightName}
                    </span>
                    <span>Projekt</span>
                    <span className="truncate font-medium text-gray-800">
                      {qfieldProjectName}
                    </span>
                  </div>
                </div>

                <Button
                  block
                  size="small"
                  className="mt-2"
                  type={releaseStatus === "accepted" ? "default" : "primary"}
                  icon={<CheckCircleOutlined />}
                  onClick={() => setReleaseStatus("accepted")}
                  disabled={releaseStatus === "accepted"}
                >
                  {releaseStatus === "accepted"
                    ? "Befliegung freigegeben"
                    : "Befliegung freigeben"}
                </Button>

                <div className="mt-2 flex items-center justify-between rounded-md border border-emerald-100 bg-emerald-50/70 px-2 py-1.5 text-[11px]">
                  <span className="flex items-center gap-1.5 font-medium text-emerald-900">
                    <CloudSyncOutlined />
                    Feldpaket
                  </span>
                  <span className="text-emerald-800">{fieldPackageStatus}</span>
                </div>
              </section>

              <Divider className="my-2.5" />

              <section>
                <div className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-gray-500">
                  Basiskarte
                </div>
                <Segmented
                  size="small"
                  block
                  value={mapStyle}
                  onChange={(value) => setMapStyle(value as PriwaMapStyle)}
                  options={basemapOptions}
                />

                <Divider className="my-2.5" />

                <h2 className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-gray-500">
                  Ebenen
                </h2>
                <div className="flex flex-col gap-1">
                  <LayerToggle
                    label={layerVisuals.orthos.label}
                    color={layerVisuals.orthos.color}
                    checked={visibility.orthos}
                    count={visibleData.orthos.length}
                    statusText={
                      visibleData.orthos.length > ORTHO_RASTER_LIMIT
                        ? `${ORTHO_RASTER_LIMIT}/${visibleData.orthos.length}`
                        : undefined
                    }
                    onChange={(checked) => updateVisibility("orthos", checked)}
                  />
                  <LayerToggle
                    label="Deadtrees-Prognose"
                    color={mapColors.deadwood.fill}
                    checked={
                      deadwoodPredictionVisible && !!selectedPredictionLabelId
                    }
                    disabled={!selectedPredictionLabelId}
                    count={selectedPredictionLabelId ? 1 : 0}
                    statusText={
                      selectedPredictionLabelId ? undefined : "nicht verfügbar"
                    }
                    onChange={setDeadwoodPredictionVisible}
                  />
                  <LayerToggle
                    label={layerVisuals.controlAreas.label}
                    color={layerVisuals.controlAreas.color}
                    checked={visibility.controlAreas}
                    count={visibleData.controlAreas.length}
                    onChange={(checked) =>
                      updateVisibility("controlAreas", checked)
                    }
                  />
                  <LayerToggle
                    label={layerVisuals.observations.label}
                    color={layerVisuals.observations.color}
                    checked={visibility.observations}
                    count={visibleData.observations.length}
                    onChange={(checked) =>
                      updateVisibility("observations", checked)
                    }
                  />
                  <LayerToggle
                    label={layerVisuals.warningPolygons.label}
                    color={layerVisuals.warningPolygons.color}
                    checked={visibility.warningPolygons}
                    count={visibleData.warningPolygons.length}
                    onChange={(checked) =>
                      updateVisibility("warningPolygons", checked)
                    }
                  />
                  <LayerToggle
                    label={layerVisuals.droneHints.label}
                    color={layerVisuals.droneHints.color}
                    checked={visibility.droneHints}
                    count={visibleData.droneHints.length}
                    onChange={(checked) =>
                      updateVisibility("droneHints", checked)
                    }
                  />
                  <LayerToggle
                    label={layerVisuals.paths.label}
                    color={layerVisuals.paths.color}
                    checked={visibility.paths}
                    count={visibleData.paths.length}
                    onChange={(checked) => updateVisibility("paths", checked)}
                  />
                  <LayerToggle
                    label="Tracks"
                    color={palette.neutral[300]}
                    checked={false}
                    disabled
                    statusText="nicht synchronisiert"
                    onChange={() => undefined}
                  />
                </div>

                <Divider className="my-2.5" />

                <section>
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <h2 className="m-0 text-[10px] font-medium uppercase tracking-[0.08em] text-gray-500">
                      Drohnenhinweise
                    </h2>
                    <div className="flex items-center gap-1.5">
                      <Tag className="m-0 border-none text-[10px]" color="blue">
                        {visibleData.droneHints.length} offen
                      </Tag>
                      <Button
                        size="small"
                        onClick={() =>
                          isDrawingHint ? stopDrawingHint() : startDrawingHint()
                        }
                        disabled={!selectedControlArea}
                      >
                        {isDrawingHint ? "Abbrechen" : "Zeichnen"}
                      </Button>
                    </div>
                  </div>
                  <div className="rounded-md border border-gray-100 bg-gray-50 px-2 py-2">
                    {visibleData.droneHints.length > 0 ? (
                      <div className="space-y-1.5">
                        {visibleData.droneHints.map((note, index) => (
                          <div
                            key={note.id}
                            className={`flex w-full items-center gap-1.5 rounded border px-2 py-1 text-[11px] transition ${
                              selectedDroneHintId === String(note.id)
                                ? "border-blue-500 bg-blue-50"
                                : "border-transparent bg-white hover:border-blue-200"
                            }`}
                          >
                            <button
                              key={note.id}
                              type="button"
                              className="min-w-0 flex-1 truncate text-left text-gray-700"
                              onClick={() => focusDroneHint(note)}
                            >
                              Hinweis {note.source_feature_id ?? index + 1}
                            </button>
                            <Button
                              size="small"
                              className="px-1.5 text-[10px]"
                              disabled={isDrawingHint}
                              onClick={() => startDrawingHint(note)}
                            >
                              Ändern
                            </Button>
                            <Button
                              danger
                              size="small"
                              className="px-1.5 text-[10px]"
                              disabled={isDrawingHint}
                              onClick={() => deleteDroneHint(note)}
                            >
                              Löschen
                            </Button>
                            <Tooltip title="Status: offen">
                              <Tag
                                color="gold"
                                className="m-0 hidden border-none text-[10px]"
                              >
                                offen
                              </Tag>
                            </Tooltip>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="m-0 text-[11px] text-gray-500">
                        Keine Drohnenhinweise in dieser Kontrollfläche.
                      </p>
                    )}
                  </div>
                </section>
              </section>
            </>
          )}
        </div>
      </aside>
    </div>
  );
};

export default Priwa;
