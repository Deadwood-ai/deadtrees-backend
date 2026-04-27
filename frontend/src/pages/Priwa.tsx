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
  Tooltip,
} from "antd";
import { AimOutlined, InfoCircleOutlined } from "@ant-design/icons";
import type { Geometry as GeoJsonGeometry } from "geojson";
import Feature from "ol/Feature";
import type { FeatureLike } from "ol/Feature";
import GeoJSON from "ol/format/GeoJSON";
import type { Geometry } from "ol/geom";
import { createEmpty, extend } from "ol/extent";
import Map from "ol/Map";
import View from "ol/View";
import { defaults as defaultInteractions } from "ol/interaction";
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
  createStandardMapControls,
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
  { value: "streets-v12", label: "Streets" },
  { value: "satellite-streets-v12", label: "Imagery" },
];

const layerVisuals: Record<
  PreviewLayerKey,
  { label: string; color: string; countLabel: string }
> = {
  controlAreas: {
    label: "Kontrollflaechen",
    color: mapColors.aoi.stroke,
    countLabel: "areas",
  },
  observations: {
    label: "Kaeferbaeume",
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
    label: "Wege context",
    color: palette.neutral[500],
    countLabel: "paths",
  },
  orthos: {
    label: "PRIMA orthos",
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

const droneHintStyle = new Style({
  fill: new Fill({ color: "rgba(37, 99, 235, 0)" }),
  stroke: new Stroke({ color: "#2563eb", width: 3 }),
});

const isMissingTableError = (message: string) =>
  message.includes("does not exist") ||
  message.includes("Could not find the table");

const PREVIEW_PAGE_SIZE = 1000;
const PREVIEW_MAX_ROWS = 20000;
const ORTHO_RASTER_LIMIT = 12;
const PRIWA_PREVIEW_DATASET_ID = 6003;

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

const createFocusControlArea = (row: Omit<OrthoRow, "geometry">) => {
  const geometry = bboxToGeometry(parseBBox(row.bbox));
  if (!geometry) {
    throw new Error(`Dataset ${PRIWA_PREVIEW_DATASET_ID} has no usable bbox`);
  }

  return {
    id: `deadtrees-dataset-${row.id}`,
    name: `Dataset ${row.id} Ruliskopf`,
    slug: row.file_name ?? `dataset-${row.id}`,
    status: "active",
    qfieldcloud_project_name: row.file_name,
    geometry,
  } satisfies ControlAreaRow;
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

const fetchPreviewDatasetOrtho = async () => {
  const { data, error } = await supabase
    .from(Settings.DATA_TABLE_FULL)
    .select(
      "id,file_name,project_id,user_id,bbox,cog_path,cog_file_size,aquisition_year,aquisition_month,aquisition_day,is_cog_done",
    )
    .eq("id", PRIWA_PREVIEW_DATASET_ID)
    .eq("is_cog_done", true)
    .not("bbox", "is", null)
    .not("cog_path", "is", null)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new Error(`Dataset ${PRIWA_PREVIEW_DATASET_ID} is not available`);
  }

  const row = data as Omit<OrthoRow, "geometry">;
  return {
    ortho: {
      ...row,
      geometry: bboxToGeometry(parseBBox(row.bbox)),
    } satisfies OrthoRow,
    controlArea: createFocusControlArea(row),
  };
};

const fetchDeadwoodPredictionLabelId = async () => {
  const { data, error } = await supabase
    .from(Settings.LABELS_TABLE)
    .select("id")
    .eq("dataset_id", PRIWA_PREVIEW_DATASET_ID)
    .eq("label_data", "deadwood")
    .eq("label_source", "model_prediction")
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data?.id ?? null;
};

async function fetchPriwaData(focusControlArea: ControlAreaRow): Promise<{
  data: PriwaData;
  warnings: string[];
}> {
  const client = priwaSupabase;
  if (!client) {
    throw new Error(
      "PRIWA Supabase is not configured. Set VITE_PRIWA_SUPABASE_URL and VITE_PRIWA_SUPABASE_ANON_KEY.",
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
  const [observations, warningPolygons, droneHints, paths] = await Promise.all([
    fetchPreviewRows<ObservationRow>("priwa_preview_observations"),
    fetchPreviewRows<WarningPolygonRow>("priwa_preview_warning_polygons"),
    fetchPreviewRows<DroneHintRow>("priwa_preview_drone_hints"),
    fetchPreviewRows<PathRow>("priwa_preview_paths"),
  ]);

  for (const [label, response] of [
    ["Kaeferbaeume", observations],
    ["Warnkarte", warningPolygons],
    ["Drohnenhinweise", droneHints],
    ["Wege", paths],
  ] as const) {
    if (response.error) {
      if (isMissingTableError(response.error.message)) {
        warnings.push(`${label}: preview view not available yet`);
        continue;
      }

      throw new Error(`${label}: ${response.error.message}`);
    }
  }

  return {
    data: {
      controlAreas: [focusControlArea],
      observations: ((observations.data ?? []) as ObservationRow[]).filter(
        (row) => intersectsControlArea(row, focusControlArea),
      ),
      warningPolygons: (
        (warningPolygons.data ?? []) as WarningPolygonRow[]
      ).filter((row) => intersectsControlArea(row, focusControlArea)),
      droneHints: ((droneHints.data ?? []) as DroneHintRow[]).filter((row) =>
        intersectsControlArea(row, focusControlArea),
      ),
      paths: ((paths.data ?? []) as PathRow[]).filter((row) =>
        intersectsControlArea(row, focusControlArea),
      ),
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
  const deadwoodPredictionLayerRef = useRef<ReturnType<
    typeof createDeadwoodVectorLayer
  > | null>(null);
  const deadwoodPredictionVisibleRef = useRef(true);
  const layerOpacityRef = useRef(0.88);
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
  const [deadwoodPredictionLabelId, setDeadwoodPredictionLabelId] = useState<
    number | null
  >(null);
  const [mapStyle, setMapStyle] = useState<PriwaMapStyle>("streets-v12");
  const [layerOpacity, setLayerOpacity] = useState(0.88);
  const [selectedControlAreaId, setSelectedControlAreaId] = useState<
    string | null
  >(null);
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
      padding: [96, 360, 96, 96],
      maxZoom: 16,
      duration: 400,
    });
  }, []);

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
        layers.orthos,
        layers.warningPolygons,
        layers.paths,
        layers.controlAreas,
        layers.droneHints,
        layers.observations,
      ],
      controls: createStandardMapControls({ includeAttribution: true }),
      interactions: defaultInteractions({ pinchRotate: false }),
      view: new View({
        center: [920000, 6165000],
        zoom: 12,
      }),
    });

    mapRef.current = map;

    return () => {
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
    void fetchPreviewDatasetOrtho()
      .then(async ({ controlArea, ortho }) => {
        const [result, predictionLabelId] = await Promise.all([
          fetchPriwaData(controlArea),
          fetchDeadwoodPredictionLabelId(),
        ]);

        setData({
          ...result.data,
          controlAreas: [controlArea],
          orthos: [ortho],
        });
        setWarnings(result.warnings);
        setDeadwoodPredictionLabelId(predictionLabelId);
        setSelectedControlAreaId(controlArea.id);
        setError(null);
      })
      .catch((fetchError: Error) => {
        setError(fetchError.message);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    layerRefs.current.controlAreas?.getSource()?.clear();
    layerRefs.current.controlAreas
      ?.getSource()
      ?.addFeatures(createFeatures(data.controlAreas, "controlAreas"));

    layerRefs.current.observations?.getSource()?.clear();
    layerRefs.current.observations
      ?.getSource()
      ?.addFeatures(createFeatures(data.observations, "observations"));

    layerRefs.current.warningPolygons?.getSource()?.clear();
    layerRefs.current.warningPolygons
      ?.getSource()
      ?.addFeatures(createFeatures(data.warningPolygons, "warningPolygons"));

    layerRefs.current.droneHints?.getSource()?.clear();
    layerRefs.current.droneHints
      ?.getSource()
      ?.addFeatures(createFeatures(data.droneHints, "droneHints"));

    layerRefs.current.orthos?.getSource()?.clear();
    layerRefs.current.orthos
      ?.getSource()
      ?.addFeatures(createFeatures(data.orthos, "orthos"));

    layerRefs.current.paths?.getSource()?.clear();
    layerRefs.current.paths
      ?.getSource()
      ?.addFeatures(createFeatures(data.paths, "paths"));

    window.setTimeout(fitToLiveData, 0);
  }, [data, fitToLiveData]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    for (const layer of orthoRasterLayerRefs.current) {
      map.removeLayer(layer);
      layer.getSource()?.dispose();
      layer.dispose();
    }

    orthoRasterLayerRefs.current = data.orthos
      .filter((row) => row.cog_path)
      .slice(0, ORTHO_RASTER_LIMIT)
      .map((row) => {
        const layer = new TileLayerWebGL({
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
          opacity: layerOpacity,
          visible: visibility.orthos,
          maxZoom: 23,
          cacheSize: 1024,
          preload: 0,
          zIndex: 18,
        });

        map.addLayer(layer);
        return layer;
      });
  }, [data.orthos, layerOpacity, visibility.orthos]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (deadwoodPredictionLayerRef.current) {
      map.removeLayer(deadwoodPredictionLayerRef.current);
      deadwoodPredictionLayerRef.current = null;
    }

    if (!deadwoodPredictionLabelId) return;

    const layer = createDeadwoodVectorLayer(deadwoodPredictionLabelId);
    layer.setZIndex(42);
    layer.setOpacity(layerOpacityRef.current);
    layer.setVisible(deadwoodPredictionVisibleRef.current);
    map.addLayer(layer);
    deadwoodPredictionLayerRef.current = layer;
  }, [deadwoodPredictionLabelId]);

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
    const isImagery = mapStyle === "satellite-streets-v12";
    streetBasemapRef.current?.setVisible(!isImagery);
    imageryBasemapRef.current?.setVisible(isImagery);

    if (isImagery) {
      imageryBasemapRef.current?.setSource(
        createWaybackSource(DEFAULT_WAYBACK_RELEASE),
      );
    }
  }, [mapStyle]);

  useEffect(() => {
    layerOpacityRef.current = layerOpacity;
    layerRefs.current.warningPolygons?.setOpacity(layerOpacity);
    layerRefs.current.droneHints?.setOpacity(layerOpacity);
    layerRefs.current.orthos?.setOpacity(layerOpacity);
    layerRefs.current.observations?.setOpacity(layerOpacity);
    layerRefs.current.paths?.setOpacity(layerOpacity);
    for (const layer of orthoRasterLayerRefs.current) {
      layer.setOpacity(layerOpacity);
    }
    deadwoodPredictionLayerRef.current?.setOpacity(layerOpacity);
  }, [layerOpacity]);

  const updateVisibility = (key: PreviewLayerKey, checked: boolean) => {
    setVisibility((current) => ({ ...current, [key]: checked }));
  };

  return (
    <div className="relative h-full min-h-screen overflow-hidden bg-slate-100">
      <div ref={mapContainerRef} className="absolute inset-0" />

      <aside className="pointer-events-auto absolute right-3 top-24 z-20 w-[260px] max-w-[calc(100vw-24px)] overflow-hidden rounded-lg border border-gray-200/70 bg-white/95 shadow-xl backdrop-blur-sm md:right-4">
        <div className="border-b border-gray-100 px-3 py-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-gray-500">
                PRIWA Monitoring
              </p>
              <h1 className="text-sm font-semibold text-gray-900">
                Spotter preview
              </h1>
            </div>
            <Tooltip title="Live layer preview from PRIWA Supabase. Upload and sync actions are intentionally inactive.">
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
              message="PRIWA Supabase is not configured"
              description="Set VITE_PRIWA_SUPABASE_URL and VITE_PRIWA_SUPABASE_ANON_KEY."
            />
          )}

          {error && (
            <Alert
              type="error"
              showIcon
              className="mb-3"
              message="Could not load PRIWA layers"
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
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-[10px] font-medium uppercase tracking-[0.08em] text-gray-500">
                    Kontrollflaechen
                  </h2>
                  <Button
                    size="small"
                    icon={<AimOutlined />}
                    onClick={fitToLiveData}
                  >
                    Fit
                  </Button>
                </div>

                {data.controlAreas.length === 0 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="No control areas visible"
                  />
                ) : (
                  <div className="space-y-2">
                    {data.controlAreas.map((area) => (
                      <button
                        key={area.id}
                        type="button"
                        className={`w-full rounded-md border px-2.5 py-1.5 text-left transition ${
                          area.id === selectedControlArea?.id
                            ? "border-emerald-600 bg-emerald-50"
                            : "border-gray-200 bg-white hover:border-gray-300"
                        }`}
                        onClick={() => setSelectedControlAreaId(area.id)}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-semibold text-gray-900">
                            {area.name}
                          </span>
                          <span
                            className={`h-2 w-2 rounded-full ${area.status === "active" ? "bg-emerald-500" : "bg-gray-300"}`}
                          />
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-gray-500">
                          {area.qfieldcloud_project_name ??
                            "No QField project yet"}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <div className="my-2 grid grid-cols-2 gap-1.5">
                <div className="rounded-md bg-gray-50 px-2 py-1.5">
                  <p className="text-[10px] uppercase tracking-[0.06em] text-gray-400">
                    Begang
                  </p>
                  <p className="truncate text-xs font-semibold text-gray-800">
                    Fruehjahr 2026
                  </p>
                </div>
                <div className="rounded-md bg-gray-50 px-2 py-1.5">
                  <p className="text-[10px] uppercase tracking-[0.06em] text-gray-400">
                    Orthos
                  </p>
                  <p className="text-xs font-semibold text-gray-800">
                    {data.orthos.length}
                  </p>
                </div>
              </div>

              <Divider className="my-2.5" />

              <section>
                <div className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-gray-500">
                  Basemap
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
                  Data Layers
                </h2>
                <div className="flex flex-col gap-1">
                  <LayerToggle
                    label={layerVisuals.orthos.label}
                    color={layerVisuals.orthos.color}
                    checked={visibility.orthos}
                    count={data.orthos.length}
                    statusText={
                      data.orthos.length > ORTHO_RASTER_LIMIT
                        ? `${ORTHO_RASTER_LIMIT}/${data.orthos.length}`
                        : undefined
                    }
                    onChange={(checked) => updateVisibility("orthos", checked)}
                  />
                  <LayerToggle
                    label="Deadtrees prediction"
                    color={mapColors.deadwood.fill}
                    checked={
                      deadwoodPredictionVisible && !!deadwoodPredictionLabelId
                    }
                    disabled={!deadwoodPredictionLabelId}
                    count={deadwoodPredictionLabelId ? 1 : 0}
                    statusText={
                      deadwoodPredictionLabelId ? undefined : "not available"
                    }
                    onChange={setDeadwoodPredictionVisible}
                  />
                  <LayerToggle
                    label={layerVisuals.controlAreas.label}
                    color={layerVisuals.controlAreas.color}
                    checked={visibility.controlAreas}
                    count={data.controlAreas.length}
                    onChange={(checked) =>
                      updateVisibility("controlAreas", checked)
                    }
                  />
                  <LayerToggle
                    label={layerVisuals.observations.label}
                    color={layerVisuals.observations.color}
                    checked={visibility.observations}
                    count={data.observations.length}
                    onChange={(checked) =>
                      updateVisibility("observations", checked)
                    }
                  />
                  <LayerToggle
                    label={layerVisuals.warningPolygons.label}
                    color={layerVisuals.warningPolygons.color}
                    checked={visibility.warningPolygons}
                    count={data.warningPolygons.length}
                    onChange={(checked) =>
                      updateVisibility("warningPolygons", checked)
                    }
                  />
                  <LayerToggle
                    label={layerVisuals.droneHints.label}
                    color={layerVisuals.droneHints.color}
                    checked={visibility.droneHints}
                    count={data.droneHints.length}
                    onChange={(checked) =>
                      updateVisibility("droneHints", checked)
                    }
                  />
                  <LayerToggle
                    label={layerVisuals.paths.label}
                    color={layerVisuals.paths.color}
                    checked={visibility.paths}
                    count={data.paths.length}
                    onChange={(checked) => updateVisibility("paths", checked)}
                  />
                  <LayerToggle
                    label="Tracks"
                    color={palette.neutral[300]}
                    checked={false}
                    disabled
                    statusText="not synced"
                    onChange={() => undefined}
                  />
                </div>

                <Divider className="my-2.5" />

                <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.08em] text-gray-500">
                  Layer Opacity
                </div>
                <Slider
                  min={0.2}
                  max={1}
                  step={0.01}
                  value={layerOpacity}
                  onChange={setLayerOpacity}
                  tooltip={{
                    formatter: (value) => `${Math.round((value || 0) * 100)}%`,
                    placement: "left",
                  }}
                />
              </section>
            </>
          )}
        </div>
      </aside>
    </div>
  );
};

export default Priwa;
