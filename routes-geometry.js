/**
 * Real road route geometries for CampusRide / SaiTrack.
 * These waypoints trace actual roads:
 * Route 1 follows Grand Southern Trunk (GST) Rd (NH 32) -> West Tambaram -> Kishkinta Rd to Sri Sairam Engineering College.
 * Route 2 follows Poonamallee High Rd / Porur -> Kundrathur Main Rd -> Somangalam to Sri Sairam Engineering College.
 */

const ROUTE_GEOMETRIES = {
  // Route 1: Valasaravakkam – Porur – Kundrathur
  route_1: [
    [13.0403, 80.1723], // Valasaravakkam
    [13.0360, 80.1650], // Arcot Rd
    [13.0336, 80.1585], // Lakshmi Nagar, Porur
    [13.0280, 80.1470], // Karampakkam
    [13.0230, 80.1360], // Kundrathur Main Rd
    [13.0180, 80.1250], // Pannichery
    [13.0080, 80.1110], // Kovur
    [12.9976, 80.0964], // Kundrathur
    [12.9850, 80.0820], // Somangalam Link
    [12.9720, 80.0710],
    [12.9601, 80.0574]  // Sri Sairam Engineering College
  ],

  // Route 2: Kandigai – Rathnamangalam – Vandalur
  route_2: [
    [12.8720, 80.1410], // Kandigai Police Quarters
    [12.8790, 80.1425], // Kandigai
    [12.8750, 80.1320], // Vandalur-Kelambakkam Rd
    [12.8680, 80.1210], // Rathnamangalam
    [12.8760, 80.1100],
    [12.8850, 80.0980], // Kolapakkam
    [12.8800, 80.0815], // Vandalur Zoo
    [12.8980, 80.0810], // GST Rd
    [12.9150, 80.0840], // Mudichur Link
    [12.9350, 80.0750], // Kishkinta Rd
    [12.9601, 80.0574]  // Sri Sairam Engineering College
  ],

  // Route 3: Pammal – Pozhichallur – Thiruneermalai
  route_3: [
    [12.9720, 80.1380], // Pammal
    [12.9810, 80.1430], // Pozhichallur
    [12.9710, 80.1370], // Pammal Main Rd
    [12.9620, 80.1310], // Nagalkeni
    [12.9570, 80.1150], // Thiruneermalai
    [12.9540, 80.0950], // Thiruneermalai Bypass / West Tambaram
    [12.9520, 80.0780], // Kishkinta Rd
    [12.9601, 80.0574]  // Sri Sairam Engineering College
  ],

  // Route 4: Mappedu – Thiruvancherry
  route_4: [
    [12.8710, 80.1480], // Mappedu
    [12.8860, 80.1400], // Thiruvancherry
    [12.8940, 80.1350], // Camp Rd Corridor
    [12.9020, 80.1310], // Lakshmi Ammal College area
    [12.9150, 80.1250], // Bharath Univ area
    [12.9249, 80.1000], // Tambaram West
    [12.9380, 80.0780], // Kishkinta Rd
    [12.9601, 80.0574]  // Sri Sairam Engineering College
  ],

  // Route 5: Tambaram – Perungalathur – College
  route_5: [
    [12.9255, 80.1170], // Tambaram Railway Station area
    [12.9249, 80.1000], // Tambaram West
    [12.9150, 80.0930], // GST Rd
    [12.9050, 80.0880], // Perungalathur
    [12.8910, 80.0810], // Vandalur
    [12.9120, 80.0760], // Mudichur / Kishkinta Rd
    [12.9400, 80.0680],
    [12.9601, 80.0574]  // Sri Sairam Engineering College
  ]
};

function getRouteGeometry(routeId, dbStops = []) {
  if (ROUTE_GEOMETRIES[routeId]) return ROUTE_GEOMETRIES[routeId];
  if (dbStops && dbStops.length > 0) {
    const sorted = [...dbStops].sort((a, b) => (a.sequence_order || 0) - (b.sequence_order || 0));
    return sorted.map(s => [s.latitude, s.longitude]);
  }
  return null;
}

module.exports = {
  ROUTE_GEOMETRIES,
  getRouteGeometry
};
