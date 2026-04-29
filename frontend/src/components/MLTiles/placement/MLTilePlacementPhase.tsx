import { useMemo, useState } from "react";
import { Button, Divider, List, Space, Tag, Typography, message } from "antd";
import { PlusOutlined, DeleteOutlined } from "@ant-design/icons";
import { IDataset } from "../../../types/dataset";
import { IMLTile } from "../../../types/mlTiles";
import { useCreateMLTile, useDeleteMLTile, useMLTiles } from "../../../hooks/useMLTiles";
import { useDatasetAOI } from "../../../hooks/useDatasetAudit";
import {
  polygon as turfPolygon,
  multiPolygon as turfMultiPolygon,
  centroid,
} from "@turf/turf";
import GeoJSON from "ol/format/GeoJSON";

interface Props {
  dataset: IDataset;
  onUnsavedChanges: (hasChanges: boolean) => void;
  onNavigateToQA: () => void;
}

const PlacementGuidelines = () => (
  <div className="rounded-md border border-dashed border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
    <b>Guidelines:</b> Place base 20cm tiles covering high-quality regions. Each tile must have ≥60% overlap with the
    AOI with no overlap between tiles.
  </div>
);

export default function MLTilePlacementPhase({ dataset, onUnsavedChanges, onNavigateToQA }: Props) {
  const { data: tiles = [], isLoading } = useMLTiles(dataset.id, 20);
  const { data: aoiData } = useDatasetAOI(dataset.id);
  const { mutateAsync: createTile } = useCreateMLTile();
  const { mutateAsync: deleteTile } = useDeleteMLTile();
  const [isSaving, setIsSaving] = useState(false);

  const geoJson = useMemo(() => new GeoJSON(), []);

  const aoiGeometry = useMemo(() => {
    if (!aoiData?.geometry) return null;
    try {
      return geoJson.readGeometry(aoiData.geometry, {
        dataProjection: "EPSG:4326",
        featureProjection: "EPSG:3857",
      });
    } catch (error) {
      console.warn("Failed to parse AOI geometry", error);
      return null;
    }
  }, [aoiData?.geometry, geoJson]);

  const aoiGeoJSON = useMemo(() => {
    if (!aoiGeometry) return null;
    return geoJson.writeGeometryObject(aoiGeometry) as GeoJSON.Polygon | GeoJSON.MultiPolygon;
  }, [aoiGeometry, geoJson]);

  const aoiCentroid = useMemo(() => {
    if (!aoiGeoJSON) return null;
    const turfGeom =
      aoiGeoJSON.type === "Polygon"
        ? turfPolygon(aoiGeoJSON.coordinates as GeoJSON.Position[][])
        : turfMultiPolygon(aoiGeoJSON.coordinates as GeoJSON.Position[][][]);
    return centroid(turfGeom).geometry.coordinates as [number, number];
  }, [aoiGeoJSON]);

  const handleCreateTile = async () => {
    if (!aoiGeoJSON || !aoiCentroid) {
      message.warning("AOI required before placing base tiles.");
      return;
    }

    const targetSizeMeters = 204.8;
    const tileGeometry: GeoJSON.Polygon = {
      type: "Polygon",
      coordinates: [
        [
          [aoiCentroid[0] - targetSizeMeters / 2, aoiCentroid[1] - targetSizeMeters / 2],
          [aoiCentroid[0] + targetSizeMeters / 2, aoiCentroid[1] - targetSizeMeters / 2],
          [aoiCentroid[0] + targetSizeMeters / 2, aoiCentroid[1] + targetSizeMeters / 2],
          [aoiCentroid[0] - targetSizeMeters / 2, aoiCentroid[1] + targetSizeMeters / 2],
          [aoiCentroid[0] - targetSizeMeters / 2, aoiCentroid[1] - targetSizeMeters / 2],
        ],
      ],
    };

    try {
      setIsSaving(true);
      await createTile({
        dataset_id: dataset.id,
        resolution_cm: 20,
        geometry: tileGeometry,
        parent_tile_id: null,
        status: "pending",
        tile_index: `20_${Date.now()}`,
        bbox_minx: tileGeometry.coordinates[0][0][0],
        bbox_miny: tileGeometry.coordinates[0][0][1],
        bbox_maxx: tileGeometry.coordinates[0][2][0],
        bbox_maxy: tileGeometry.coordinates[0][2][1],
        aoi_coverage_percent: 100, // Will be calculated on map
        deadwood_prediction_coverage_percent: null,
        forest_cover_prediction_coverage_percent: null,
      });
      onUnsavedChanges(true);
      message.success("Tile created.");
    } catch (error) {
      console.error(error);
      message.error("Failed to create tile");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteTile = async (tile: IMLTile) => {
    try {
      await deleteTile({ tileId: tile.id, datasetId: dataset.id });
      onUnsavedChanges(true);
      message.success("Tile deleted");
    } catch (error) {
      console.error(error);
      message.error("Failed to delete tile");
    }
  };

  return (
    <div className="flex h-full w-full flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <Typography.Title level={4} style={{ marginBottom: 4 }}>
            Phase 1: Place Base Tiles
          </Typography.Title>
          <Typography.Text type="secondary">
            Create 20cm tiles covering AOI. Avoid overlap and ensure sufficient coverage.
          </Typography.Text>
        </div>
        <Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreateTile} loading={isSaving}>
            Add Base Tile
          </Button>
          <Button disabled={tiles.length === 0} onClick={onNavigateToQA}>
            Continue to QA
          </Button>
        </Space>
      </div>

      <PlacementGuidelines />

      <Divider orientation="left">Existing Tiles</Divider>
      <List
        bordered
        dataSource={tiles}
        loading={isLoading}
        locale={{ emptyText: "No tiles placed yet." }}
        renderItem={(tile) => (
          <List.Item
            actions={[
              <Button
                key="delete"
                icon={<DeleteOutlined />}
                danger
                type="text"
                onClick={() => handleDeleteTile(tile)}
              />,
            ]}
          >
            <List.Item.Meta
              title={
                <Space>
                  <span className="font-medium">{tile.tile_index}</span>
                  <Tag color="blue">{tile.resolution_cm} cm</Tag>
                  <Tag>{tile.status}</Tag>
                </Space>
              }
              description={
                <Space size="large">
                  <span>AOI overlap: {tile.aoi_coverage_percent ? `${tile.aoi_coverage_percent}%` : "n/a"}</span>
                  <span>
                    Bounds: {tile.bbox_minx.toFixed(1)}, {tile.bbox_miny.toFixed(1)} × {tile.bbox_maxx.toFixed(1)},{" "}
                    {tile.bbox_maxy.toFixed(1)}
                  </span>
                </Space>
              }
            />
          </List.Item>
        )}
      />
    </div>
  );
}
