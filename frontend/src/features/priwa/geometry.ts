import { booleanIntersects } from "@turf/turf";
import type { Geometry as GeoJsonGeometry } from "geojson";
import Feature from "ol/Feature";
import GeoJSON from "ol/format/GeoJSON";
import type { Geometry } from "ol/geom";
import type { ControlAreaRow, OrthoRow, PreviewRow } from "./types";
import {
  PRIWA_COMPARE_CONTROL_AREA_ID,
  PRIWA_COMPARE_DATASET_IDS,
} from "./constants";

export const geoJsonFormat = new GeoJSON();

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

export const bboxTextToGeometry = (bbox: string | null) =>
  bboxToGeometry(parseBBox(bbox));

export const createFeatures = <TRow extends PreviewRow>(
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

export const intersectsControlArea = <TRow extends PreviewRow>(
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

export const sortControlAreas = (areas: ControlAreaRow[]) =>
  [...areas].sort((left, right) => {
    if (left.id === PRIWA_COMPARE_CONTROL_AREA_ID) return -1;
    if (right.id === PRIWA_COMPARE_CONTROL_AREA_ID) return 1;
    return left.name.localeCompare(right.name, "de");
  });

export const assignOrthoControlArea = (
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

export const getOrthoDate = (row: OrthoRow | null | undefined) => {
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

export const getFlightName = (row: OrthoRow | null | undefined) =>
  row ? `Befliegung ${getOrthoDate(row)}` : "Befliegung nicht verfügbar";

export const compactOrthos = (
  rows: Array<OrthoRow | null | undefined>,
): OrthoRow[] => rows.filter((row): row is OrthoRow => !!row);
