import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Geometry as GeoJsonGeometry } from "geojson";
import Feature from "ol/Feature";
import { createEmpty, extend } from "ol/extent";
import type { Geometry } from "ol/geom";
import Map from "ol/Map";
import View from "ol/View";
import { defaults as defaultInteractions } from "ol/interaction";
import Draw, { DrawEvent } from "ol/interaction/Draw";
import TileLayerWebGL from "ol/layer/WebGLTile.js";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { GeoTIFF } from "ol/source";
import "ol/ol.css";

import { createDeadwoodVectorLayer } from "../components/DatasetDetailsMap/createVectorLayer";
import { isPriwaSupabaseConfigured } from "../hooks/usePriwaSupabase";
import { Settings } from "../config";
import {
  createOpenFreeMapLibertyLayerGroup,
  createWaybackSource,
  createWaybackTileLayer,
} from "../utils/basemaps";
import {
  DEFAULT_WAYBACK_RELEASE,
  DEADWOOD_PREDICTION_OPACITY,
  ORTHO_RASTER_LIMIT,
  ORTHO_RASTER_OPACITY,
  PRIWA_COMPARE_CONTROL_AREA_ID,
  SWIPE_CSS_VAR,
  initialData,
  initialVisibility,
} from "../features/priwa/constants";
import {
  ControlAreaPanel,
  DrawingHintOverlay,
  SpotterPanel,
  SwipeControl,
} from "../features/priwa/components";
import {
  fetchDeadwoodPredictionLabelIds,
  fetchPreviewDatasetOrthos,
  fetchPriwaData,
} from "../features/priwa/api";
import {
  applySwipePosition,
  controlAreaStyle,
  droneHintStyle,
  observationStyle,
  orthoFootprintStyle,
  pathStyle,
  warningStyle,
} from "../features/priwa/mapStyles";
import {
  compactOrthos,
  createFeatures,
  geoJsonFormat,
  getFlightName,
  intersectsControlArea,
  sortControlAreas,
} from "../features/priwa/geometry";
import type {
  ControlAreaRow,
  DroneHintRow,
  LayerVisibility,
  PreviewLayerKey,
  PriwaData,
  PriwaMapStyle,
  PriwaReleaseStatus,
} from "../features/priwa/types";

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
        <SwipeControl
          currentOrthoId={currentOrtho?.id}
          previousOrthoId={previousOrtho?.id}
          swipePosition={swipePosition}
          onSwipePositionChange={setSwipePosition}
        />
      )}

      {isDrawingHint && (
        <DrawingHintOverlay isEditing={Boolean(editingDroneHintId)} />
      )}

      <ControlAreaPanel
        controlAreas={data.controlAreas}
        loading={loading}
        selectedControlArea={selectedControlArea}
        onFit={fitToLiveData}
        onSelectControlArea={(area) => {
          setSelectedControlAreaId(area.id);
          fitControlArea(area);
        }}
      />

      <SpotterPanel
        currentFlightName={currentFlightName}
        deadwoodPredictionVisible={deadwoodPredictionVisible}
        error={error}
        fieldPackageStatus={fieldPackageStatus}
        isDrawingHint={isDrawingHint}
        isPriwaSupabaseConfigured={isPriwaSupabaseConfigured}
        loading={loading}
        mapStyle={mapStyle}
        previousFlightName={previousFlightName}
        qfieldProjectName={qfieldProjectName}
        releaseStatus={releaseStatus}
        selectedControlArea={selectedControlArea}
        selectedDroneHintId={selectedDroneHintId}
        selectedPredictionLabelId={selectedPredictionLabelId}
        visibleData={visibleData}
        visibility={visibility}
        warnings={warnings}
        onDeleteDroneHint={deleteDroneHint}
        onFocusDroneHint={focusDroneHint}
        onMapStyleChange={setMapStyle}
        onReleaseStatusChange={setReleaseStatus}
        onStartDrawingHint={startDrawingHint}
        onStopDrawingHint={stopDrawingHint}
        onToggleDeadwoodPrediction={setDeadwoodPredictionVisible}
        onUpdateVisibility={updateVisibility}
      />
    </div>
  );
};

export default Priwa;
