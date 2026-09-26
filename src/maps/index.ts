import { config } from "../config";
import { CachedMaps } from "./cache";
import { GoogleMaps } from "./google";
import { SampleMaps } from "./sample";
import type { Maps } from "./types";

export type { Maps, VenueHit } from "./types";

export function createMaps(): Maps {
  switch (config.mapsMode) {
    case "sample":
      return new SampleMaps();
    case "cache":
      return new CachedMaps(config.mapsCacheDir);
    case "live":
      if (!config.mapsServerKey) throw new Error("MAPS_MODE=live 需要 MAPS_SERVER_KEY");
      return new CachedMaps(config.mapsCacheDir, new GoogleMaps(config.mapsServerKey));
  }
}
