// 地理：活动区域的默认半径、两点间的距离。

/** 活动区域的默认半径（公里）。地图缓存按查询参数存，运行时和 fetch-maps 脚本必须用同一个值才能命中。 */
export const AREA_RADIUS_KM = 15;

export interface LatLng {
  lat: number;
  lng: number;
}

/** 两点间的球面距离（公里）。 */
export function distanceKm(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
