# The Cole Report

A sleek, terminal-style dashboard for tracking gas prices, crude oil, US 10Y Treasury, weather, and headlines.

## Setup

### 1. API keys (free)

| Service | Purpose | Sign up |
|---------|---------|---------|
| Alpha Vantage | US 10Y Treasury | [alphavantage.co](https://www.alphavantage.co/support/#api-key) |
| EIA | Brent Crude | [eia.gov/opendata](https://www.eia.gov/opendata/register.php) |
| NewsAPI | Domestic & international headlines | [newsapi.org](https://newsapi.org/register) |
| OpenWeatherMap | Charlotte weather | [openweathermap.org](https://openweathermap.org/api) |

### 2. Backend

```bash
cd backend
cp .env.example .env
# Edit .env and add your API keys
npm install
npm run dev
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Optional: run both

From project root:

```bash
cd backend && npm install && npm run dev
```

Then in another terminal:

```bash
cd frontend && npm install && npm run dev
```

## Project structure

```
├── backend/           # Express API proxy
│   ├── server.js      # Routes: /api/gas, /api/brent, /api/treasury, /api/news, /api/weather
│   └── .env           # Your API keys (create from .env.example)
├── frontend/
│   ├── src/
│   │   ├── components/   # Modular widgets (easy to add/remove)
│   │   │   ├── Header.jsx
│   │   │   ├── MetricCard.jsx
│   │   │   ├── NewsSection.jsx
│   │   │   └── WeatherCard.jsx
│   │   └── App.jsx
│   └── public/
│       └── Headshot.JPEG   # Logo (top-left)
└── README.md
```

## Adding new widgets

1. Add a backend route in `backend/server.js`
2. Add a fetch in `frontend/src/App.jsx`
3. Create a component in `frontend/src/components/` or reuse `MetricCard`

## Notes

- **Gas prices**: Scraped from AAA [gasprices.aaa.com](https://gasprices.aaa.com/) — no API key needed.
- **Crude**: Pulled from EIA Brent series (`PET.RBRTE.D`) using `EIA_API_KEY`.
- **News**: NewsAPI free tier limits past 12-hour queries; older stories may not appear.
"# the-cole-report" 
