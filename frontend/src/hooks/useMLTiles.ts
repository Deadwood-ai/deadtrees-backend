// ============================================================================
// DEPRECATED: This file is kept for backward compatibility.
// Use hooks/useReferencePatches.ts for new code.
// ============================================================================

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useClearPatchSessionLock,
  useCompletePatchGeneration,
  useCreateReferencePatch,
  useDeleteReferencePatch,
  useGenerateNestedPatches,
  useNestedPatches,
  usePatchProgress,
  usePatchSessionLock,
  useReferencePatches,
  useReopenPatchGeneration,
  useSetPatchSessionLock,
  useUpdatePatchGeometry,
  useUpdatePatchStatus,
} from "./useReferencePatches";
import { IMLTile, mlTileToReferencePatch, referencePatchToMLTile, TileStatus } from "../types/mlTiles";

type CreateMLTileInput = Omit<
  Partial<IMLTile> &
    Pick<
      IMLTile,
      | "dataset_id"
      | "resolution_cm"
      | "geometry"
      | "parent_tile_id"
      | "tile_index"
      | "bbox_minx"
      | "bbox_miny"
      | "bbox_maxx"
      | "bbox_maxy"
      | "aoi_coverage_percent"
      | "deadwood_prediction_coverage_percent"
      | "forest_cover_prediction_coverage_percent"
    >,
  "id" | "created_at" | "updated_at" | "user_id" | "patch_index"
>;

export {
  usePatchSessionLock as useTileSessionLock,
  useSetPatchSessionLock as useSetTileSessionLock,
  useClearPatchSessionLock as useClearTileSessionLock,
  usePatchProgress as useTileProgress,
  useCompletePatchGeneration as useCompleteTileGeneration,
  useReopenPatchGeneration as useReopenTileGeneration,
};

const normalizeTileInput = (
  tile: CreateMLTileInput,
) => {
  const patch = mlTileToReferencePatch({
    ...tile,
    id: 0,
    user_id: "",
    created_at: "",
    updated_at: "",
    status: tile.status ?? "pending",
    utm_zone: tile.utm_zone ?? "31N",
    epsg_code: tile.epsg_code ?? 32631,
  });
  const { id, user_id, created_at, updated_at, ...createPayload } = patch;
  void id;
  void user_id;
  void created_at;
  void updated_at;
  return {
    ...createPayload,
    deadwood_validated: createPayload.deadwood_validated ?? null,
    forest_cover_validated: createPayload.forest_cover_validated ?? null,
  };
};

export function useMLTiles(datasetId: number | undefined, resolution?: IMLTile["resolution_cm"]) {
  const query = useReferencePatches(datasetId, resolution);

  return {
    ...query,
    data: query.data?.map(referencePatchToMLTile),
  };
}

export function useNestedTiles(parentTileId: number | undefined) {
  const query = useNestedPatches(parentTileId);

  return {
    ...query,
    data: query.data?.map(referencePatchToMLTile),
  };
}

export function useCreateMLTile() {
  const mutation = useCreateReferencePatch();

  return {
    ...mutation,
    mutate: (
      tile: CreateMLTileInput,
      options?: Parameters<typeof mutation.mutate>[1],
    ) => mutation.mutate(normalizeTileInput(tile), options),
    mutateAsync: async (
      tile: CreateMLTileInput,
      options?: Parameters<typeof mutation.mutateAsync>[1],
    ) => referencePatchToMLTile(await mutation.mutateAsync(normalizeTileInput(tile), options)),
  };
}

export function useUpdateTileStatus() {
  const mutation = useUpdatePatchStatus();

  return {
    ...mutation,
    mutate: (
      variables: { tileId: number; status: TileStatus },
      options?: Parameters<typeof mutation.mutate>[1],
    ) => mutation.mutate({ patchId: variables.tileId, status: variables.status }, options),
    mutateAsync: async (
      variables: { tileId: number; status: TileStatus },
      options?: Parameters<typeof mutation.mutateAsync>[1],
    ) => referencePatchToMLTile(await mutation.mutateAsync({ patchId: variables.tileId, status: variables.status }, options)),
  };
}

export function useUpdateTileGeometry() {
  const mutation = useUpdatePatchGeometry();

  return {
    ...mutation,
    mutate: (
      variables: Parameters<typeof mutation.mutate>[0] extends infer T
        ? Omit<T, "patchId"> & { tileId: number }
        : never,
      options?: Parameters<typeof mutation.mutate>[1],
    ) => {
      const { tileId, ...rest } = variables;
      return mutation.mutate({ ...rest, patchId: tileId }, options);
    },
    mutateAsync: async (
      variables: Parameters<typeof mutation.mutateAsync>[0] extends infer T
        ? Omit<T, "patchId"> & { tileId: number }
        : never,
      options?: Parameters<typeof mutation.mutateAsync>[1],
    ) => {
      const { tileId, ...rest } = variables;
      return referencePatchToMLTile(await mutation.mutateAsync({ ...rest, patchId: tileId }, options));
    },
  };
}

export function useDeleteMLTile() {
  const mutation = useDeleteReferencePatch();

  return {
    ...mutation,
    mutate: (
      variables: { tileId: number; datasetId: number },
      options?: Parameters<typeof mutation.mutate>[1],
    ) => mutation.mutate({ patchId: variables.tileId, datasetId: variables.datasetId }, options),
    mutateAsync: (variables: { tileId: number; datasetId: number }, options?: Parameters<typeof mutation.mutateAsync>[1]) =>
      mutation.mutateAsync({ patchId: variables.tileId, datasetId: variables.datasetId }, options),
  };
}

export function useGenerateNestedTiles() {
  const mutation = useGenerateNestedPatches();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (tile: IMLTile) => {
      const patches = await mutation.mutateAsync(mlTileToReferencePatch(tile));
      return patches.map(referencePatchToMLTile);
    },
    onSuccess: (_data, tile) => {
      queryClient.invalidateQueries({ queryKey: ["reference-patches", tile.dataset_id] });
      queryClient.invalidateQueries({ queryKey: ["reference-patches", "nested", tile.id] });
      queryClient.invalidateQueries({ queryKey: ["patch-progress", tile.dataset_id] });
    },
  });
}
