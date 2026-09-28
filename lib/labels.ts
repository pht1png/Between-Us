/**
 * Shared Thai display labels for values that appear on more than one surface.
 *
 * A pure leaf, like `lib/sections.ts`: the only import is type-only (erased at runtime), so both
 * client components and server-only modules can pull from it without dragging anything along. That
 * matters for `lib/export.ts` in particular — it needs these labels but must not import a React
 * component to get them.
 */

import type { Sex } from "@/lib/types";

/** Used by the admin roster, the match reveal card, and the CSV export. One copy, so the wording
 * can't drift between the screen a participant sees and the file a host downloads. */
export const SEX_LABELS_TH: Record<Sex, string> = {
  male: "ชาย",
  female: "หญิง",
  lgbtq_male: "LGBTQ+ (ชาย)",
  lgbtq_female: "LGBTQ+ (หญิง)",
};
