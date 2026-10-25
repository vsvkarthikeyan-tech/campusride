/**
 * Real road route geometries for CampusRide / SaiTrack.
 * These waypoints trace actual roads:
 * Route 1 follows Grand Southern Trunk (GST) Rd (NH 32) -> West Tambaram -> Kishkinta Rd to Sri Sairam Engineering College.
 * Route 2 follows Poonamallee High Rd / Porur -> Kundrathur Main Rd -> Somangalam to Sri Sairam Engineering College.
 */

const ROUTE_GEOMETRIES = {
  route_1: [
    // 1. Guindy Kathipara Junction
    [13.0067, 80.2025],
    [13.0035, 80.1980],
    [12.9970, 80.1905],
    [12.9890, 80.1810],
    [12.9810, 80.1700], // Chennai Airport / Meenambakkam GST Rd
    [12.9740, 80.1590],
    // 2. Pallavaram Bus Stand
    [12.9680, 80.1490],
    [12.9610, 80.1450],
    // 3. Chromepet MIT Gate
    [12.9516, 80.1408],
    [12.9440, 80.1340],
    [12.9360, 80.1260], // Tambaram Sanatorium
    [12.9300, 80.1170],
    // 4. Tambaram West Bus Terminus
    [12.9249, 80.1000],
    [12.9305, 80.0880], // Mudichur Road
    [12.9410, 80.0760], // Kishkinta Road turn
    [12.9500, 80.0660], // Approaching Sai Leo Nagar
    [12.9560, 80.0610],
    // 5. Sri Sairam Engineering College Main Campus Gate
    [12.9601, 80.0574]
  ],

  route_2: [
    // 1. Koyambedu CMBT
    [13.0674, 80.2057],
    [13.0600, 80.2010],
    [13.0510, 80.1900], // Vadapalani / Arcot Road
    [13.0420, 80.1760], // Ramapuram
    // 2. Porur Toll Junction
    [13.0336, 80.1585],
    [13.0240, 80.1420], // Kundrathur Main Road
    [13.0130, 80.1210], // Kovur
    // 3. Kundrathur Murugan Temple Gate
    [12.9976, 80.0964],
    [12.9880, 80.0860],
    // 4. Somangalam Junction
    [12.9723, 80.0732],
    [12.9660, 80.0640], // Somangalam - West Tambaram link
    // 5. Sri Sairam Engineering College Main Gate
    [12.9601, 80.0574]
  ]
};

function getRouteGeometry(routeId) {
  return ROUTE_GEOMETRIES[routeId] || null;
}

module.exports = {
  ROUTE_GEOMETRIES,
  getRouteGeometry
};
