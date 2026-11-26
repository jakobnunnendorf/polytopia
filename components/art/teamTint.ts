// Recolours a unit sprite's team colour (the blue cloth, shields and flags of the stock art) to a
// player's colour, keeping its shading; skin, wood and metal stay as they are. Web only (canvas);
// elsewhere the stock sprite is shown. Results are cached per sprite and colour.
import { useEffect, useState } from "react";
import { Platform, type ImageSourcePropType } from "react-native";
import { Asset } from "expo-asset";

const BASE_HUE = 240; // official Imperius royal blue (tunics, shields, sails)
const cache = new Map<string, string | Promise<string | null>>();

function hsv(hex: string) {
  const n = parseInt(hex.slice(1, 7), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  return rgbToHsv(r, g, b);
}
function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, mx ? d / mx : 0, mx];
}
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
}

const uriOf = (source: ImageSourcePropType): string | null => {
  if (typeof source === "string") return source;
  if (typeof source === "number") return Asset.fromModule(source).uri;
  const s = source as { uri?: string; default?: string };
  return s?.uri ?? s?.default ?? null;
};

async function tint(uri: string, color: string): Promise<string | null> {
  const img = new (globalThis as unknown as { Image: typeof HTMLImageElement }).Image();
  img.crossOrigin = "anonymous";
  img.src = uri;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  const [th, ts, tv] = hsv(color);
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 8) continue;
    const [h, s, v] = rgbToHsv(px[i] / 255, px[i + 1] / 255, px[i + 2] / 255);
    // team blue: hue near Imperius royal blue (240°), avoiding cyan accents (<212°)
    const dh = Math.abs(((h - BASE_HUE + 540) % 360) - 180);
    if (dh > 28 || s < 0.28) continue;
    const nh = (th + (h - BASE_HUE) + 360) % 360;
    const ns = Math.min(1, s * (ts / 0.72));
    const nv = Math.min(1, v * (0.6 + 0.45 * tv));
    const [r, g, b] = hsvToRgb(nh, ns, nv);
    px[i] = r * 255;
    px[i + 1] = g * 255;
    px[i + 2] = b * 255;
  }
  ctx.putImageData(data, 0, 0);
  return c.toDataURL("image/png");
}

/** multiplies a grayscale mask sprite (e.g. lighthouse tier crystal) by `color`, keeping its 3D facets */
async function multiplyTint(uri: string, color: string): Promise<string | null> {
  const img = new (globalThis as unknown as { Image: typeof HTMLImageElement }).Image();
  img.crossOrigin = "anonymous";
  img.src = uri;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  const n = parseInt(color.slice(1, 7), 16);
  const tr = ((n >> 16) & 255) / 255;
  const tg = ((n >> 8) & 255) / 255;
  const tb = (n & 255) / 255;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 8) continue;
    px[i] = Math.round(px[i] * tr);
    px[i + 1] = Math.round(px[i + 1] * tg);
    px[i + 2] = Math.round(px[i + 2] * tb);
  }
  ctx.putImageData(data, 0, 0);
  return c.toDataURL("image/png");
}

function useCachedTint(
  source: ImageSourcePropType,
  color: string | undefined,
  prefix: string,
  fn: (uri: string, color: string) => Promise<string | null>,
): ImageSourcePropType {
  const uri = Platform.OS === "web" && color ? uriOf(source) : null;
  const key = uri ? `${prefix}|${uri}|${color}` : "";
  const hit = key ? cache.get(key) : undefined;
  const [, bump] = useState(0);
  useEffect(() => {
    if (!uri || !color || cache.has(key)) return;
    const p = fn(uri, color)
      .catch(() => null)
      .then((r) => {
        if (r) cache.set(key, r);
        else cache.delete(key);
        return r;
      });
    cache.set(key, p);
    void p.then(() => bump((x) => x + 1));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (hit && typeof hit !== "string") void hit.then(() => bump((x) => x + 1));
  }, [hit]);
  return typeof hit === "string" ? { uri: hit } : source;
}

/** the sprite recoloured to `color` (web), else the stock sprite */
export function useTeamSprite(source: ImageSourcePropType, color?: string): ImageSourcePropType {
  return useCachedTint(source, color, "team", tint);
}

/** a grayscale overlay sprite multiplied by `color` (web), else the stock sprite */
export function useMultiplySprite(source: ImageSourcePropType, color?: string): ImageSourcePropType {
  return useCachedTint(source, color, "mul", multiplyTint);
}
