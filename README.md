# CampusRide / SaiTrack — College Bus Tracking & Safety System

CampusRide (SaiTrack) is a full-stack real-time college transportation management portal featuring:
- **Leaflet.js + OpenStreetMap**: Real roads, street names, landmarks, and bus corridors without proprietary API keys.
- **Sri Sairam Engineering College Coordinates**: Configurable institutional campus hub ($12.9601^\circ\text{ N}, 80.0574^\circ\text{ E}$) and real road corridors (GST Corridor & Porur/Kundrathur Corridor).
- **Driver / Hardware GPS Ingest**: Real-time vehicle telemetry ingestion via REST and WebSocket channels.
- **UHF RFID Gate Scanners**: Automatic attendance check-in with 5-minute debounce cooldown against duplicate reads.
- **Security & RBAC**: Salted Bcrypt password hashing, standard JWT session tokens, and role-based permissions (Student, Parent, Driver, Admin).
- **Parent Notifications & Safety**: Emergency panic dispatch, proximity geofence alerts, and digital fee receipt logging.

---

## 🚀 Quick Start (Local Setup)

### 1. Requirements
- Node.js (v18+)

### 2. Run the Application
Double-click `start.bat` or run:
```powershell
npm start
# Or directly:
node server.js
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser.

### 3. Run Automated Tests
Double-click `test.bat` or run:
```powershell
npm test
# Or directly:
node test/suite.js
```
All 61 system integration tests will execute and verify the application.

---

## 🔑 Login Credentials

| Role | Email | Password | Access Details |
| :--- | :--- | :--- | :--- |
| **Student** | `student@saitrack.com` | `student123` | Real Leaflet map, boarding stop selector, emergency panic alert, RFID card scan demo, Google Pay test checkout. |
| **Parent** | `parent@saitrack.com` | `parent123` | Child selector, live bus ETA, proximity warnings, 30-day attendance calendar, fee receipts. |
| **Driver** | `ramesh@saitrack.com` | `driver123` | Authorized for transmitting real-time bus GPS coordinates. |
| **Admin** | `admin@saitrack.com` | `admin123` | Fleet command center, route designer, roll call attendance register, student RFID tag CRUD. |

---

## 📂 Project Structure

```
Campus Ride/
├── config.js               # Central configuration (campus coords, ports, keys)
├── server.js               # Express + WebSocket real-time server & REST APIs
├── db.js                   # Atomic database layer with Bcrypt & RFID debouncing
├── db.json                 # JSON database with verified routes, stops, and users
├── routes-geometry.js      # Real road waypoint geometries following actual streets
├── .env.example            # Environment variables template
├── .env                    # Active local environment settings
├── start.bat               # One-click server launch script
├── test.bat                # One-click test runner script
├── public/
│   ├── index.html          # Single-Page Application (SPA) dashboard layout
│   ├── css/
│   │   └── styles.css      # Styling including Leaflet dark popups and legends
│   └── js/
│       ├── app.js          # SPA router and WebSocket connection with auto-reconnect
│       ├── auth.js         # Authentication, registration, and OTP verification
│       ├── student.js      # Student dashboard with Leaflet map & telemetry
│       ├── parent.js       # Parent dashboard with child tracker & receipts
│       └── admin.js        # Admin command center, route editor & attendance
├── test/
│   └── suite.js            # 61-point automated integration test suite
└── package.json            # Node.js dependencies and scripts
```
