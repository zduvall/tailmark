# Tailmark - Real-Time Flight Status Lookup

Tailmark is a single-page web application for tracking live flight statuses using AeroDataBox via RapidAPI. It features a Bring Your Own Key (BYOK) architecture and a 10-minute client-side localStorage caching mechanism to optimize network calls and API rate limits.

---

## Key Features

1. **API Key Management (BYOK Pattern):**
   - Store RapidAPI keys locally in browser `localStorage` (`tailmark_rapidapi_key`).
   - Keys are kept strictly client-side and never sent to intermediary servers.
   - Includes controls to view, edit, toggle visibility, or clear stored keys.

2. **Real-Time Flight Tracking:**
   - Supports live flight lookups by IATA/ICAO flight number (e.g., `DL1193`, `AA100`, `UA2402`).
   - Displays real-time estimated vs scheduled departure/arrival times, gate/terminal info, status badges, progress indicators, aircraft model, and baggage claim details.

3. **Multi-Day Segment Tabs & Smart Selection:**
   - Automatically parses AeroDataBox response arrays for multi-leg flights within 24–48 hour windows.
   - Auto-selects default active segment using priority logic: Active status (`EnRoute`/`Boarding`) > Recently Landed (< 1 hour) > Next Upcoming Flight.
   - Enables instant tab switching between segments without additional network requests.

4. **Client-Side Caching (10-Minute TTL):**
   - Caches API payloads in `localStorage` scoped by flight number and date (`aerodatabox_{FLIGHT_NUMBER}_{YYYY-MM-DD}`).
   - Serves cached responses instantly for requests within 10 minutes.
   - Provides explicit visual cache indicators and a manual "Fetch Fresh Data" bypass button.

5. **Developer Tools & Raw CSS Styling:**
   - Built with vanilla HTML5, CSS3, and ES6 JavaScript with zero external frameworks or dependencies.
   - Includes an accordion payload inspector with one-click JSON clipboard copying.

---

## Local Setup Instructions

No build steps or package installations required. Run locally with any standard HTTP server.

### Option 1: Using `npx serve` (Node.js)

```bash
npx -y serve ./
```

Open the printed local URL (e.g., `http://localhost:3000`) in your browser.

### Option 2: Using Python HTTP Server

```bash
python3 -m http.server 8000
```

Visit `http://localhost:8000`.

### Option 3: VS Code Live Server Extension

1. Open project directory in Visual Studio Code.
2. Right-click `index.html` and select **Open with Live Server**.

---

## API Setup (RapidAPI / AeroDataBox)

1. Create a free account at [RapidAPI.com](https://rapidapi.com/).
2. Search for **AeroDataBox** and subscribe to the **Basic (Free)** tier.
3. Copy your `x-rapidapi-key` header value and paste it into the Tailmark API configuration card.

---

## Client-Side Caching Engine

### 1. Cache Key Format

Entries are stored in `localStorage` using a scoped key structure:
$$\text{Cache Key} = \text{aerodatabox\_\{FLIGHT\_NUMBER\}\_\{YYYY-MM-DD\}}$$
_Example:_ `aerodatabox_DL1193_2026-08-25`

### 2. Cache Payload Structure

<details>

<summary>Expand to see full structure</summary>

```json
{
  "timestamp": 1787699855000,
  "data": [
    {
      "airline": { "name": "Delta Air Lines" },
      "number": "DL1193",
      "status": "EnRoute",
      "departure": {
        "airport": { "iata": "JFK", "municipalityName": "New York" },
        "scheduledTime": { "local": "2026-08-25 14:30+02:00" },
        "terminal": "4",
        "gate": "B22"
      },
      "arrival": {
        "airport": { "iata": "LAX", "municipalityName": "Los Angeles" },
        "scheduledTime": { "local": "2026-08-25 18:00+02:00" },
        "terminal": "2",
        "gate": "25A",
        "baggageBelt": "5"
      },
      "aircraft": { "model": "Boeing 737-900" }
    }
  ]
}
```

</details>

### 3. Caching Workflow & TTL Check

When a user submits a flight search:

```
                           [ Flight Search Submitted ]
                                       │
                         Normalize Flight Code (e.g. DL1193)
                                       │
                  Construct Key: aerodatabox_DL1193_{YYYY-MM-DD}
                                       │
                      Does key exist in localStorage?
                        ├── NO  ──► [ Make HTTP Request ]
                        │                  │
                        └── YES            ▼
                              │      Save to localStorage with timestamp
                              ▼
                Calculate Age: Now - timestamp
                        │
                Is Age < 10 minutes (600,000 ms)?
                        ├── YES ──► [ Serve from localStorage immediately ]
                        │           Show Cached Result Badge
                        │
                        └── NO  ──► [ Cache Expired: Remove Key ]
                                           │
                                           ▼
                                   [ Make Fresh HTTP Request ]
```

### 4. Cache Bypass & Fresh Data Fetching

Each cached result card provides a **Fetch Fresh Data** button. Clicking this button bypasses the 10-minute cache check, executes an immediate live fetch to AeroDataBox via RapidAPI, and updates the stored cache payload with fresh data.

---

## Project Structure

- `index.html`: Semantic HTML5 document containing application layout, input forms, and dynamic result containers.
- `styles.css`: Dark-theme CSS design system with custom properties, grid/flexbox layouts, and status indicator components.
- `app.js`: Core application logic managing input normalization, API authentication, local caching, time parsing, segment selection, and DOM updates.
- `README.md`: Project technical documentation and setup guide.
