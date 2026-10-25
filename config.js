require('dotenv').config();
const crypto = require('crypto');

// Generate a runtime secret fallback if JWT_SECRET is not provided
const fallbackSecret = crypto.randomBytes(32).toString('hex');

module.exports = {
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  JWT_SECRET: process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? null : 'campusride_dev_secret_key_2026_xyz'),
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '24h',
  
  // Demo and Simulation Flags
  DEMO_MODE: process.env.DEMO_MODE !== 'false', // Default true for demonstration, set 'false' in prod
  SIMULATION_ENABLED: process.env.SIMULATION_ENABLED === 'true', // Default false unless explicitly enabled
  EXPOSE_MOCK_OTP: process.env.EXPOSE_MOCK_OTP === 'true', // Never expose OTP in prod API response
  
  // Institutional Campus Information (Configurable for Sri Sairam Engineering College or any campus)
  CAMPUS: {
    name: process.env.CAMPUS_NAME || 'Sri Sairam Engineering College',
    code: process.env.CAMPUS_CODE || 'SEC',
    address: process.env.CAMPUS_ADDRESS || 'Sai Leo Nagar, West Tambaram, Chennai - 600044',
    latitude: parseFloat(process.env.CAMPUS_LAT || 12.9601),
    longitude: parseFloat(process.env.CAMPUS_LNG || 80.0574),
    geofence_radius_meters: parseInt(process.env.CAMPUS_GEOFENCE_RADIUS || 300, 10)
  },

  // Map Tile Configuration
  MAP: {
    tileLayerUrl: process.env.MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
    maxZoom: 19
  },

  // GPS & RFID Reader Hardware API Keys (for IoT devices)
  GPS_DEVICE_API_KEY: process.env.GPS_DEVICE_API_KEY || 'gps_device_dev_key_sec_2026',
  RFID_READER_API_KEY: process.env.RFID_READER_API_KEY || 'rfid_reader_dev_key_sec_2026',
  
  // RFID Cooldown window in milliseconds to prevent duplicate reads
  RFID_DEBOUNCE_MS: parseInt(process.env.RFID_DEBOUNCE_MS || 300000, 10) // 5 minutes
};
