import type { Area, Place, TravelTime, Venue } from "../types";

export interface VenueHit {
  place: Place;
  venue: Venue;
}

/** 地图适配层（§5.5）。三种实现：sample（虚构数据）、cache（只读缓存）、live（Google + 写缓存）。 */
export interface Maps {
  /** 地标和集合点："the library" → 附近的候选地点，按相关度排序。 */
  searchPlaces(query: string, near?: Area): Promise<Place[]>;
  /** 候选活动地点和餐厅。 */
  searchVenues(query: string, kind: Venue["kind"], near: Area): Promise<VenueHit[]>;
  /** 驾车时间。拿不到的组合直接不返回，调用方必须把它当成未知，绝不能当成 0。 */
  travelMinutes(origins: Place[], destinations: Place[]): Promise<TravelTime[]>;
}
