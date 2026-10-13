const EARTH_RADIUS_METERS = 6371000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Great-circle distance between two lat/long points, in meters.
 */
export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_METERS * c;
}

// Phones indoors often report a coarse (Wi-Fi/cell/cached) fix several
// hundred metres off - on 2026-10-12 about 49 students in one room all
// reported the same point ~420 m from a 350 m geofence and were refused, then
// marked absent. The tolerance is added to the building radius:
//   - a flat GEOFENCE_GRACE_METERS (default 100), and
//   - the fix's own reported accuracy when the client sends it, capped so a
//     bogus huge accuracy can't open the fence.
// The larger of the two applies. Set GEOFENCE_GRACE_METERS=0 for the old
// strict behaviour.
const ACCURACY_CREDIT_CAP_METERS = 150;

export function getGeofenceToleranceMeters(accuracyMeters?: number | null): number {
  const raw = Number(process.env.GEOFENCE_GRACE_METERS);
  const grace = Number.isFinite(raw) && raw >= 0 ? raw : 100;
  const accuracy =
    accuracyMeters != null && Number.isFinite(accuracyMeters) && accuracyMeters > 0
      ? Math.min(accuracyMeters, ACCURACY_CREDIT_CAP_METERS)
      : 0;
  return Math.max(grace, accuracy);
}

export function isWithinRadius(
  studentLat: number,
  studentLon: number,
  buildingLat: number,
  buildingLon: number,
  radiusMeters: number,
  accuracyMeters?: number | null
): { isWithinRange: boolean; distanceMeters: number } {
  const distanceMeters = haversineDistanceMeters(studentLat, studentLon, buildingLat, buildingLon);
  const allowed = radiusMeters + getGeofenceToleranceMeters(accuracyMeters);
  return { isWithinRange: distanceMeters <= allowed, distanceMeters };
}
