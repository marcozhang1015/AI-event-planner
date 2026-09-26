// 地图缓存（§5.5）：cache 模式只读，live 模式缺什么请求什么并写回。
// 缓存目录不进 git（地图服务商的条款限制缓存和存储它的数据），只在本机、只在 hackathon 期间用。

import { createHash } from "node:crypto";
import type { Area, Place, TravelTime, Venue } from "../types";
import type { Maps, VenueHit } from "./types";

type TravelTable = Record<string, TravelTime>;

export class CachedMaps implements Maps {
  private travel?: TravelTable;

  constructor(
    private readonly dir: string,
    private readonly live?: Maps,
  ) {}

  private async cached<T>(method: string, args: unknown, fetch: () => Promise<T>): Promise<T | undefined> {
    const key = createHash("sha256").update(JSON.stringify([method, args])).digest("hex").slice(0, 16);
    const file = Bun.file(`${this.dir}/${method}-${key}.json`);
    if (await file.exists()) return (await file.json()) as T;
    if (!this.live) {
      console.warn(`[maps] 缓存里没有 ${method} ${JSON.stringify(args)}`);
      return undefined;
    }
    const value = await fetch();
    await Bun.write(file, JSON.stringify(value, null, 2));
    return value;
  }

  async searchPlaces(query: string, near?: Area): Promise<Place[]> {
    return (await this.cached("searchPlaces", [query, near], () => this.live!.searchPlaces(query, near))) ?? [];
  }

  async searchVenues(query: string, kind: Venue["kind"], near: Area): Promise<VenueHit[]> {
    return (await this.cached("searchVenues", [query, kind, near], () => this.live!.searchVenues(query, kind, near))) ?? [];
  }

  /** 车程按"起点|终点"逐对缓存，参与者变了也能复用已经请求过的组合。 */
  async travelMinutes(origins: Place[], destinations: Place[]): Promise<TravelTime[]> {
    const table = await this.travelTable();
    const pairKey = (from: Place, to: Place) => `${from.id}|${to.id}`;
    const missingOrigins = origins.filter((from) => destinations.some((to) => !table[pairKey(from, to)]));
    if (missingOrigins.length && this.live) {
      for (const travel of await this.live.travelMinutes(missingOrigins, destinations)) {
        table[`${travel.fromPlaceId}|${travel.toPlaceId}`] = travel;
      }
      await Bun.write(`${this.dir}/travel-times.json`, JSON.stringify(table, null, 2));
    }
    return origins.flatMap((from) => destinations.flatMap((to) => table[pairKey(from, to)] ?? []));
  }

  private async travelTable(): Promise<TravelTable> {
    if (!this.travel) {
      const file = Bun.file(`${this.dir}/travel-times.json`);
      this.travel = (await file.exists()) ? ((await file.json()) as TravelTable) : {};
    }
    return this.travel;
  }
}
