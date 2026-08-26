# ✈️ Tailmark - Real-Time Flight Status Lookup (Proof of Concept)

Tailmark is a lightweight, responsive, single-page web application for looking up live flight statuses using the **AeroDataBox API via RapidAPI**. It implements a **Bring Your Own Key (BYOK)** pattern and an onboard **10-minute client-side `localStorage` caching mechanism** to preserve API rate limits and conserve monthly quota usage.

---

## 🌟 Key Features

1. **API Key Management (BYOK Pattern):**
   - Enter and store your personal RapidAPI key directly in your browser.
   - API keys are persisted securely in `localStorage` under `tailmark_rapidapi_key` and never transmitted to any intermediary servers.
   - Includes controls to edit, toggle key visibility, or clear your stored key at any time.

2. **Real-Time Flight Tracking:**
   - Track live flight statuses by inputting any valid flight number (e.g., `DL1193`, `AA100`, `UA2402`, `BA178`).
   - Automatically normalizes inputs (trims whitespace, converts to uppercase).
   - Displays live flight progress bar, status badges (`EnRoute`, `Expected`, `Landed`, `Scheduled`, `Cancelled`), departure and arrival airport codes, cities, scheduled and actual/revised times, terminals, gates, baggage belts, and aircraft model.

3. **Multi-Day Segment Tabs & Smart Selection:**
   - When AeroDataBox returns multiple flight legs across 24–48 hours, renders a horizontal tab bar (e.g. `Mon, Aug 24`, `Tue, Aug 25`).
   - Automatically auto-selects the default active segment based on priority rules (Active `EnRoute`/`Boarding`, Recently Landed `< 1 hr`, or Next Upcoming flight).
   - Allows immediate tab switching without triggering new API calls.

4. **Client-Side Caching (10-Minute TTL):**
   - Prevents redundant network requests to RapidAPI by caching API responses in browser `localStorage`.
   - Served instantly if requested within 10 minutes of the previous lookup.
   - Clear visual indicators (⚡ **Cached Result** vs 🟢 **Live Request**) with an optional "Fetch Fresh Data" bypass button.

5. **Modern Raw CSS Aesthetics:**
   - Built with modern HTML5 and CSS3 (CSS Custom Properties, Flexbox & CSS Grid, glassmorphism card styling, responsive layouts, micro-animations, accessible color hierarchy). No heavyweight frameworks required.

---

## 🚀 Local Setup Instructions

No build steps or Node modules installation required! You can run Tailmark locally using any simple HTTP web server.

### Option 1: Using `npx serve` (Node.js)

Run the following command in the project root directory:

```bash
npx -y serve ./
```

Then open the local URL (e.g., `http://localhost:3000`) in your web browser.

### Option 2: Using Python HTTP Server

If you have Python installed:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

### Option 3: VS Code Live Server Extension

1. Open the project folder in Visual Studio Code.
2. Right-click `index.html` and choose **"Open with Live Server"**.

---

## 🔑 How to Get a Free RapidAPI Key

1. Create a free account at [RapidAPI.com](https://rapidapi.com/).
2. Search for **AeroDataBox** and subscribe to the **Basic (Free)** tier.
3. Copy the `x-rapidapi-key` header value from the code snippet panel and paste it into Tailmark.

---

## 🧠 Client-Side Caching Mechanism (`localStorage`)

To optimize performance and conserve the user's free monthly RapidAPI quota, Tailmark implements a custom client-side caching engine in [`app.js`](app.js):

### 1. Cache Key Format

Cache entries are stored in `localStorage` using a scoped key format:
$$\text{Cache Key} = \text{aerodatabox\_\{FLIGHT\_NUMBER\}\_\{YYYY-MM-DD\}}$$
_Example:_ `aerodatabox_DL1193_2026-08-25`

### 2. Cache Payload Structure

Each cached item is saved as a serialized JSON object containing a timestamp and the original AeroDataBox API response array:

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
                        │           Show "⚡ Cached Result" Badge
                        │
                        └── NO  ──► [ Cache Expired: Remove Key ]
                                           │
                                           ▼
                                   [ Make Fresh HTTP Request ]
```

### 4. Cache Bypass & Fresh Data Fetching

Each cached result card provides a **"Fetch Fresh Data"** button. Clicking this button bypasses the 10-minute cache check, executes an immediate live fetch to AeroDataBox via RapidAPI, and updates the stored cache payload with fresh data.

---

## 📁 Project Structure

- `index.html`: Semantic HTML5 document with accessible forms, RapidAPI key controls, quick-test flight chips, and flight detail containers.
- `styles.css`: CSS design system containing custom properties, modern dark theme styling, responsive grid layouts, animations, and status indicators.
- `app.js`: Application logic handling input normalization, BYOK key storage (`tailmark_rapidapi_key`), `localStorage` 10-minute cache validation, fetch network requests to AeroDataBox, and DOM rendering.
- `README.md`: Project documentation and setup guide.
