import type { FeatureLike } from "ol/Feature";
import { Fill, Stroke, Style, Circle as CircleStyle } from "ol/style";
import { mapColors } from "../../theme/mapColors";
import { palette } from "../../theme/palette";
import { SWIPE_CSS_VAR } from "./constants";

export const controlAreaStyle = new Style({
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

export const warningStyle = (feature: FeatureLike) => {
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

export const observationStyle = new Style({
  image: new CircleStyle({
    radius: 6,
    fill: new Fill({ color: mapColors.deadwood.fill }),
    stroke: new Stroke({ color: "#ffffff", width: 2 }),
  }),
});

export const pathStyle = new Style({
  stroke: new Stroke({ color: "rgba(107, 114, 128, 0.72)", width: 1.5 }),
});

export const orthoFootprintStyle = new Style({
  fill: new Fill({ color: "rgba(27, 94, 53, 0.08)" }),
  stroke: new Stroke({ color: palette.primary[600], width: 1.8 }),
});

export const droneHintStyle = (feature: FeatureLike) => {
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

const getSwipeClip = (position: number) => `inset(0 0 0 ${position}%)`;

export const applySwipePosition = (
  map: import("ol/Map").default,
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
      element.style.setProperty("-webkit-clip-path", element.style.clipPath);
    });
};
