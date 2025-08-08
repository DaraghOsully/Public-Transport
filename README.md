# THA25 – Ireland Public Transport Explorer (Vite + React)

A minimal web app that fetches **THA25** from the **CSO PxStat** API (or accepts a CSV export) to show historical/current public transport usage in Ireland, plus simple projections.

## Quick Start ( easiest path )

1. **Install Node.js** (v18+ recommended). If you don't have it, get it from nodejs.org.
2. Unzip this project.
3. Open a terminal in the project folder and run:
   ```bash
   npm install
   npm run dev
   ```
4. Open the URL printed in the terminal (usually http://localhost:5173).

## How to use

- The app tries to load **THA25** automatically via the PxStat API.
- If it fails, go to **CSO.ie → PxStat → THA25 → Download CSV**, then use the **Upload THA25 CSV** option.
- Toggle which modes count as **public transport** by clicking series in the legend.
- Switch the projection type (**Linear** or **CAGR**) and choose a target year.

## Deploy (the easy way)

**Netlify (free):**
1. Create a free Netlify account.
2. Drag-and-drop the **`dist/`** folder into Netlify after building:
   ```bash
   npm run build
   ```
3. Or connect a GitHub repo and let Netlify build automatically.

**GitHub Pages:**
1. Build locally:
   ```bash
   npm run build
   ```
2. Serve `/dist` with any static host or use a GitHub Pages action (see Vite docs).

## Notes

- Data source: **CSO Ireland** – PxStat table **THA25**.
- Values/labels change over time. This app uses heuristics to find the **State** total and **public-transport-like** modes (Bus / Train / DART / LUAS).
- Projections are just mathy toys, **not** official forecasts.

---

Built with **Vite + React + Recharts**.
