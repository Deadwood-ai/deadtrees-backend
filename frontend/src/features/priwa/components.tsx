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
import { ORTHO_RASTER_LIMIT, basemapOptions, layerVisuals } from "./constants";
import type {
  ControlAreaRow,
  DroneHintRow,
  LayerVisibility,
  PreviewLayerKey,
  PriwaData,
  PriwaMapStyle,
  PriwaReleaseStatus,
} from "./types";
import { mapColors } from "../../theme/mapColors";
import { palette } from "../../theme/palette";

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

export const SwipeControl = ({
  currentOrthoId,
  previousOrthoId,
  swipePosition,
  onSwipePositionChange,
}: {
  currentOrthoId?: number;
  previousOrthoId?: number;
  swipePosition: number;
  onSwipePositionChange: (position: number) => void;
}) => (
  <>
    <div
      className="pointer-events-none absolute top-0 z-10 h-full w-px bg-white/90 shadow-[0_0_0_1px_rgba(31,41,55,0.35)]"
      style={{ left: `${swipePosition}%` }}
    />
    <div className="pointer-events-auto fixed bottom-5 left-4 right-4 z-30 rounded-lg border border-gray-200/80 bg-white/95 px-4 py-2 shadow-xl backdrop-blur-sm">
      <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-gray-700">
        <span>Alt · Dataset {previousOrthoId}</span>
        <span className="text-emerald-800">Neu · Dataset {currentOrthoId}</span>
      </div>
      <Slider
        min={0}
        max={100}
        step={1}
        value={swipePosition}
        onChange={onSwipePositionChange}
        tooltip={{ formatter: null }}
      />
    </div>
  </>
);

export const DrawingHintOverlay = ({ isEditing }: { isEditing: boolean }) => (
  <div className="pointer-events-none absolute left-1/2 top-24 z-30 w-[min(440px,calc(100vw-32px))] -translate-x-1/2 rounded-lg border border-blue-200 bg-blue-50/95 px-4 py-3 shadow-xl backdrop-blur-sm">
    <div className="flex items-start gap-3">
      <InfoCircleOutlined className="mt-0.5 text-lg text-blue-600" />
      <div>
        <p className="m-0 text-sm font-semibold text-gray-900">
          {isEditing ? "Hinweis neu zeichnen" : "Polygon zeichnen"}
        </p>
        <p className="m-0 mt-1 text-xs leading-5 text-gray-700">
          Punkte in die Karte klicken, mit Doppelklick abschließen.
        </p>
      </div>
    </div>
  </div>
);

export const ControlAreaPanel = ({
  controlAreas,
  loading,
  selectedControlArea,
  onFit,
  onSelectControlArea,
}: {
  controlAreas: ControlAreaRow[];
  loading: boolean;
  selectedControlArea: ControlAreaRow | null;
  onFit: () => void;
  onSelectControlArea: (area: ControlAreaRow) => void;
}) => (
  <aside className="pointer-events-auto absolute left-3 top-24 z-20 w-[260px] max-w-[calc(100vw-24px)] overflow-hidden rounded-lg border border-gray-200/70 bg-white/95 shadow-xl backdrop-blur-sm">
    <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-2">
      <h2 className="m-0 text-[10px] font-medium uppercase tracking-[0.08em] text-gray-500">
        Kontrollflächen
      </h2>
      <Button size="small" icon={<AimOutlined />} onClick={onFit}>
        Zoom
      </Button>
    </div>
    <div className="max-h-[calc(100vh-144px)] overflow-y-auto p-2">
      {loading ? (
        <Skeleton active paragraph={{ rows: 3 }} title={false} />
      ) : controlAreas.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="Keine Kontrollfläche sichtbar"
        />
      ) : (
        <div className="space-y-1.5">
          {controlAreas.map((area) => (
            <button
              key={area.id}
              type="button"
              className={`w-full rounded-md border px-2 py-1.5 text-left transition ${
                area.id === selectedControlArea?.id
                  ? "border-emerald-600 bg-emerald-50"
                  : "border-gray-200 bg-white hover:border-gray-300"
              }`}
              onClick={() => onSelectControlArea(area)}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-semibold text-gray-900">
                  {area.name}
                </span>
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    area.status === "active" ? "bg-emerald-500" : "bg-gray-300"
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
);

export const SpotterPanel = ({
  currentFlightName,
  deadwoodPredictionVisible,
  error,
  fieldPackageStatus,
  isDrawingHint,
  isPriwaSupabaseConfigured,
  loading,
  mapStyle,
  previousFlightName,
  qfieldProjectName,
  releaseStatus,
  selectedControlArea,
  selectedDroneHintId,
  selectedPredictionLabelId,
  visibleData,
  visibility,
  warnings,
  onDeleteDroneHint,
  onFocusDroneHint,
  onMapStyleChange,
  onReleaseStatusChange,
  onStartDrawingHint,
  onStopDrawingHint,
  onToggleDeadwoodPrediction,
  onUpdateVisibility,
}: {
  currentFlightName: string;
  deadwoodPredictionVisible: boolean;
  error: string | null;
  fieldPackageStatus: string;
  isDrawingHint: boolean;
  isPriwaSupabaseConfigured: boolean;
  loading: boolean;
  mapStyle: PriwaMapStyle;
  previousFlightName: string;
  qfieldProjectName: string;
  releaseStatus: PriwaReleaseStatus;
  selectedControlArea: ControlAreaRow | null;
  selectedDroneHintId: string | null;
  selectedPredictionLabelId: number | null;
  visibleData: PriwaData;
  visibility: LayerVisibility;
  warnings: string[];
  onDeleteDroneHint: (hint: DroneHintRow) => void;
  onFocusDroneHint: (hint: DroneHintRow) => void;
  onMapStyleChange: (style: PriwaMapStyle) => void;
  onReleaseStatusChange: (status: PriwaReleaseStatus) => void;
  onStartDrawingHint: (hint?: DroneHintRow) => void;
  onStopDrawingHint: () => void;
  onToggleDeadwoodPrediction: (visible: boolean) => void;
  onUpdateVisibility: (key: PreviewLayerKey, checked: boolean) => void;
}) => (
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
                {releaseStatus === "accepted" ? "freigegeben" : "in Prüfung"}
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
              onClick={() => onReleaseStatusChange("accepted")}
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
              onChange={(value) => onMapStyleChange(value as PriwaMapStyle)}
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
                onChange={(checked) => onUpdateVisibility("orthos", checked)}
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
                onChange={onToggleDeadwoodPrediction}
              />
              <LayerToggle
                label={layerVisuals.controlAreas.label}
                color={layerVisuals.controlAreas.color}
                checked={visibility.controlAreas}
                count={visibleData.controlAreas.length}
                onChange={(checked) =>
                  onUpdateVisibility("controlAreas", checked)
                }
              />
              <LayerToggle
                label={layerVisuals.observations.label}
                color={layerVisuals.observations.color}
                checked={visibility.observations}
                count={visibleData.observations.length}
                onChange={(checked) =>
                  onUpdateVisibility("observations", checked)
                }
              />
              <LayerToggle
                label={layerVisuals.warningPolygons.label}
                color={layerVisuals.warningPolygons.color}
                checked={visibility.warningPolygons}
                count={visibleData.warningPolygons.length}
                onChange={(checked) =>
                  onUpdateVisibility("warningPolygons", checked)
                }
              />
              <LayerToggle
                label={layerVisuals.droneHints.label}
                color={layerVisuals.droneHints.color}
                checked={visibility.droneHints}
                count={visibleData.droneHints.length}
                onChange={(checked) =>
                  onUpdateVisibility("droneHints", checked)
                }
              />
              <LayerToggle
                label={layerVisuals.paths.label}
                color={layerVisuals.paths.color}
                checked={visibility.paths}
                count={visibleData.paths.length}
                onChange={(checked) => onUpdateVisibility("paths", checked)}
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
                      isDrawingHint ? onStopDrawingHint() : onStartDrawingHint()
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
                          onClick={() => onFocusDroneHint(note)}
                        >
                          Hinweis {note.source_feature_id ?? index + 1}
                        </button>
                        <Button
                          size="small"
                          className="px-1.5 text-[10px]"
                          disabled={isDrawingHint}
                          onClick={() => onStartDrawingHint(note)}
                        >
                          Ändern
                        </Button>
                        <Button
                          danger
                          size="small"
                          className="px-1.5 text-[10px]"
                          disabled={isDrawingHint}
                          onClick={() => onDeleteDroneHint(note)}
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
);
