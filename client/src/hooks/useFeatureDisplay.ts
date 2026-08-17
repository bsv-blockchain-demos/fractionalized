import { useMemo } from "react";

export type FeatureMap = Record<string, number>;

export interface DisplayFeature {
  key: string;
  count: number;
  label: string;
  icon: string;
}

const ICONS: Record<string, string> = {
  bedroom: "🛏️",
  studio: "🛏️",
  bathroom: "🚿",
  toilet: "🚽",
  kitchen: "🍳",
  balcony: "🧊", // no perfect emoji, using ice cube as abstract; can swap to an icon set later
  parking: "🚗",
  livingroom: "🛋️",
  living: "🛋️",
  garage: "🚗",
  storage: "📦",
};

function camelToWords(s: string) {
  // Convert camelCase or PascalCase to words and also handle underscores
  return s
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(key: string) {
  return key.toLowerCase().replace(/\s+/g, "");
}

function pickIcon(rawKey: string) {
  const k = normalizeKey(rawKey);
  // direct match
  if (ICONS[k]) return ICONS[k];
  // partials
  if (k.includes("bed")) return ICONS["bedroom"];
  if (k.includes("bath")) return ICONS["bathroom"];
  if (k.includes("toilet") || k.includes("wc")) return ICONS["toilet"];
  if (k.includes("kitchen")) return ICONS["kitchen"];
  if (k.includes("balcon")) return ICONS["balcony"];
  if (k.includes("park") || k.includes("garage")) return ICONS["parking"];
  if (k.includes("living")) return ICONS["livingroom"];
  if (k.includes("studio")) return ICONS["studio"];
  return "🏷️";
}

function pluralizeLabel(label: string, count: number) {
  if (count === 1) return label;
  // Simple pluralization: add 's' to last word if not already plural
  const parts = label.split(" ");
  const last = parts.pop() as string;
  if (/s$/i.test(last)) {
    parts.push(last);
    return parts.join(" ");
  }
  // basic 'y' -> 'ies'
  if (/[^aeiou]y$/i.test(last)) {
    parts.push(last.replace(/y$/i, "ies"));
    return parts.join(" ");
  }
  parts.push(last + "s");
  return parts.join(" ");
}

export function useFeatureDisplay(features: FeatureMap | undefined) {
  return useMemo<DisplayFeature[]>(() => {
    if (!features) return [];
    const entries = Object.entries(features);
    // stable order: bedrooms/studio, bathrooms/toilets, living, kitchen, balcony, parking, then rest alpha
    const order = [
      "studio",
      "bedroom",
      "bathroom",
      "toilet",
      "livingroom",
      "living",
      "kitchen",
      "balcony",
      "parking",
    ];
    const scored = entries.map(([rawKey, count]) => {
      const normalized = normalizeKey(rawKey);
      const baseIdx = order.findIndex((o) => normalized.includes(o));
      const score = baseIdx === -1 ? 100 + normalized.charCodeAt(0) : baseIdx;
      const baseLabel = camelToWords(rawKey);
      const label = pluralizeLabel(baseLabel, Number(count));
      const icon = pickIcon(rawKey);
      return { key: rawKey, count: Number(count), label, icon, score } as any;
    });
    scored.sort((a: any, b: any) => a.score - b.score || a.label.localeCompare(b.label));
    return scored.map((s: any) => ({ key: s.key, count: s.count, label: s.label, icon: s.icon }));
  }, [features]);
}
