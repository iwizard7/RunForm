---
description: How to implement GPS Route Track Visualization on the Dashboard when first location data is available.
---

# GPS Route Implementation Plan

This workflow describes the exact steps an agent should take when the user uploads their first JSON containing GPS/location tracking data (the `route` or `locations` array).

**Prerequisites:**
The backend has already been pre-configured up to version `v0.3.x`:
1. `src/lib/db.ts` Migration 5 already added `route_json TEXT` to the `workouts` table.
2. `src/lib/parser.ts` `WorkoutData` already accepts `route?: Array<{lat: number, lng: number, hr?: number}>`.

## Step-by-Step Implementation

1. **Inspect the JSON Format:**
   First, analyze the user's new JSON payload. Identify what the geographic coordinate array is called (e.g., `exercises[0].samples.location` or `route` or `locations`) and how `latitude`, `longitude`, and (optionally) `heartRate` or `speed` are keyed.

2. **Update the Parser (`src/lib/parser.ts`):**  
   Modify `parseWorkoutJSON` to correctly extract the route array from `RawWorkoutData` into the standard format:
   ```ts
   // mapping the specific user JSON format to our standard
   route: json.someLocationArray?.map((loc) => ({
      lat: loc.latitude,
      lng: loc.longitude,
      hr: loc.heartRate // if available
   })) || [],
   ```

3. **Build the SVG Component (`src/components/ui/RouteMap.tsx`):**
   Create a pure SVG path visualizer component that takes `workout.route`. It shouldn't use heavy libraries like Leaflet unless the user explicitly requests tiles. A clean SVG polyline stretching to fill its container looks very premium.
   - Calculate `minLat`, `maxLat`, `minLng`, `maxLng`.
   - Scale coordinates to an SVG viewBox (e.g., `viewBox="0 0 100 100"`).
   - If HR or speed data is available for points, render line segments with dynamic colors (e.g., transitioning from green to red based on intensity) instead of a single solid line.

4. **Integrate into the Dashboard (`src/app/page.tsx`):**
   Within the `activeTab === 'dashboard'` section, under the HR Analysis or as a new card, add:
   ```tsx
   {workout.route && workout.route.length > 0 && (
     <div className="premium-card">
       <h3>Карта Маршрута / Route</h3>
       <RouteMap route={workout.route} />
     </div>
   )}
   ```
   
5. **Update Next features list:**
   Check them off in `TODO.md` and bump the minor version in `package.json`.
