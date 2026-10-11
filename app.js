/**
 * Tailmark Flight Status Tracker - Core Application Logic
 * AeroDataBox (via RapidAPI) Integration & 10-Minute LocalStorage Caching System
 */

(function () {
  'use strict';

  // Constants
  const STORAGE_API_KEY = 'tailmark_rapidapi_key';
  const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes in milliseconds

  // DOM Elements
  const apiKeySection = document.getElementById('apiKeySection');
  const apiKeyForm = document.getElementById('apiKeyForm');
  const apiKeyInput = document.getElementById('apiKeyInput');
  const toggleKeyVisibilityBtn = document.getElementById('toggleKeyVisibilityBtn');
  const keyConfigStatus = document.getElementById('keyConfigStatus');
  const apiKeyActiveView = document.getElementById('apiKeyActiveView');
  const maskedKeyDisplay = document.getElementById('maskedKeyDisplay');
  const editApiKeyBtn = document.getElementById('editApiKeyBtn');
  const clearApiKeyBtn = document.getElementById('clearApiKeyBtn');
  const headerApiKeyStatus = document.getElementById('headerApiKeyStatus');

  const flightSearchForm = document.getElementById('flightSearchForm');
  const flightInput = document.getElementById('flightInput');
  const searchBtn = document.getElementById('searchBtn');
  const searchBtnText = document.getElementById('searchBtnText');
  const searchSpinner = document.getElementById('searchSpinner');
  const alertContainer = document.getElementById('alertContainer');
  const resultsContainer = document.getElementById('resultsContainer');

  // Application State
  let currentApiKey = localStorage.getItem(STORAGE_API_KEY) || '';

  // Initialize Application
  function init() {
    setupApiKeyUI();
    setupEventListeners();
  }

  /* ==========================================================================
     1. API Key Management (BYOK)
     ========================================================================== */

  function setupApiKeyUI() {
    if (currentApiKey) {
      // Key exists in localStorage
      keyConfigStatus.textContent = 'Configured';
      keyConfigStatus.classList.add('configured');
      
      apiKeyForm.classList.add('hidden');
      apiKeyActiveView.classList.remove('hidden');
      maskedKeyDisplay.textContent = maskApiKey(currentApiKey);

      headerApiKeyStatus.innerHTML = `
        <span class="status-dot active"></span>
        <span>API Key Ready</span>
      `;
    } else {
      // No key saved
      keyConfigStatus.textContent = 'Not Configured';
      keyConfigStatus.classList.remove('configured');

      apiKeyForm.classList.remove('hidden');
      apiKeyActiveView.classList.add('hidden');
      apiKeyInput.value = '';

      headerApiKeyStatus.innerHTML = `
        <span class="status-dot"></span>
        <span>Key Required</span>
      `;
    }
  }

  function maskApiKey(key) {
    if (!key) return '';
    if (key.length <= 8) return '••••' + key.slice(-2);
    return key.slice(0, 4) + '••••••••' + key.slice(-4);
  }

  function saveApiKey(key) {
    const trimmed = key.trim();
    if (!trimmed) {
      showAlert('Please enter a valid RapidAPI key.', 'error');
      return false;
    }
    localStorage.setItem(STORAGE_API_KEY, trimmed);
    currentApiKey = trimmed;
    setupApiKeyUI();
    showAlert('RapidAPI key saved successfully!', 'info');
    return true;
  }

  function clearApiKey() {
    localStorage.removeItem(STORAGE_API_KEY);
    currentApiKey = '';
    setupApiKeyUI();
    resultsContainer.classList.add('hidden');
    resultsContainer.innerHTML = '';
    showAlert('API key removed from local storage.', 'info');
  }

  /* ==========================================================================
     2. Client-Side Caching System (10-Min TTL)
     ========================================================================== */

  /**
   * Helper to format current date as YYYY-MM-DD for cache key scoping.
   */
  function getTodayDateString() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Generates the cache key in format: aerodatabox_{FLIGHT_NUMBER}_{YYYY-MM-DD}
   */
  function getCacheKey(flightNumber) {
    return `aerodatabox_${flightNumber.toUpperCase()}_${getTodayDateString()}`;
  }

  /**
   * Look up cached response in localStorage.
   * Returns parsed object if valid and within 10 minutes TTL.
   */
  function getCachedFlight(flightNumber) {
    const cacheKey = getCacheKey(flightNumber);
    const rawData = localStorage.getItem(cacheKey);

    if (!rawData) return null;

    try {
      const cacheObj = JSON.parse(rawData);
      if (!cacheObj || !cacheObj.timestamp || !cacheObj.data) {
        localStorage.removeItem(cacheKey);
        return null;
      }

      const now = Date.now();
      const ageMs = now - cacheObj.timestamp;

      // Check 10-minute expiry
      if (ageMs < CACHE_TTL_MS) {
        return {
          data: cacheObj.data,
          timestamp: cacheObj.timestamp,
          ageMs: ageMs,
          ageMinutes: Math.floor(ageMs / 60000),
          remainingMinutes: Math.ceil((CACHE_TTL_MS - ageMs) / 60000)
        };
      } else {
        // Cache expired
        localStorage.removeItem(cacheKey);
        return null;
      }
    } catch (err) {
      console.warn('Error parsing cached flight data:', err);
      localStorage.removeItem(cacheKey);
      return null;
    }
  }

  /**
   * Store API response in localStorage with timestamp.
   */
  function setCachedFlight(flightNumber, data) {
    const cacheKey = getCacheKey(flightNumber);
    const cacheObj = {
      timestamp: Date.now(),
      data: data
    };
    try {
      localStorage.setItem(cacheKey, JSON.stringify(cacheObj));
    } catch (err) {
      console.warn('Failed to save flight to cache (storage full?):', err);
    }
  }

  /* ==========================================================================
     3. Flight Status Fetching & Smart Default Segment Selection
     ========================================================================== */

  /**
   * Precedence hierarchies for extracting the most relevant operational timestamp
   * from arrival or departure endpoint objects.
   */
  const TIME_PRECEDENCE = {
    DISPLAY: ['actual', 'revised', 'runway', 'scheduled', 'predicted'],
    LANDED: ['revised', 'runway', 'scheduled', 'predicted'],
    UPCOMING: ['revised', 'scheduled', 'predicted', 'runway'],
    OPERATIONAL: ['revised', 'scheduled', 'runway', 'predicted'],
    DELAY: ['revised', 'runway', 'predicted']
  };

  /**
   * Resolves the highest-priority available local timestamp string from an endpoint.
   * Supports field prefixes ('revised', 'runway') or full property names ('revisedTime', 'runwayTime').
   *
   * @param {Object} endpoint - The departure or arrival object.
   * @param {Array<string>} [priority=TIME_PRECEDENCE.DISPLAY] - Order of preference.
   * @returns {string|null} - The local ISO/datetime string, or null if none found.
   */
  function getEndpointLocalTime(endpoint, priority = TIME_PRECEDENCE.DISPLAY) {
    if (!endpoint) return null;
    for (const key of priority) {
      const prop = key.endsWith('Time') ? key : `${key}Time`;
      const val = endpoint[prop]?.local;
      if (val) return val;
    }
    return null;
  }

  /**
   * Smart Default Tab Selection logic:
   * Rule 1. Active Flight: EnRoute, Boarding, CheckIn, Active, in-flight.
   * Rule 2. Recently Landed (< 1 hour): Landed / Arrived within last 60 minutes relative to current time.
   * Rule 3. Next Upcoming Flight: Expected / Scheduled or earliest departure in future.
   * Rule 4. Fallback: Segment whose departure time is closest to current timestamp.
   */
  function getSmartDefaultSegmentIndex(data) {
    if (!Array.isArray(data) || data.length === 0) return 0;
    const now = Date.now();

    // Rule 1: Active Flight
    const activeStates = ['enroute', 'boarding', 'checkin', 'active', 'in-flight'];
    const activeIdx = data.findIndex((item) => {
      const s = (item.status || '').toLowerCase().replace(/[\s\-_]/g, '');
      return activeStates.includes(s);
    });
    if (activeIdx !== -1) return activeIdx;

    // Rule 2: Recently Landed (< 1 hour = 3600000 ms)
    const landedStates = ['landed', 'arrived'];
    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      const s = (item.status || '').toLowerCase().replace(/[\s\-_]/g, '');
      if (landedStates.includes(s)) {
        const arrTimeStr = getEndpointLocalTime(item.arrival, TIME_PRECEDENCE.LANDED);
        if (arrTimeStr) {
          const arrMs = new Date(arrTimeStr).getTime();
          if (!isNaN(arrMs)) {
            const timeSinceLanded = now - arrMs;
            if (timeSinceLanded >= 0 && timeSinceLanded <= 60 * 60 * 1000) {
              return i;
            }
          }
        }
      }
    }

    // Rule 3: Next Upcoming Flight (earliest departure in future)
    let earliestUpcomingIdx = -1;
    let minFutureDiff = Infinity;

    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      const s = (item.status || '').toLowerCase().replace(/[\s\-_]/g, '');
      const depTimeStr = getEndpointLocalTime(item.departure, TIME_PRECEDENCE.UPCOMING);
      let isUpcoming = (s === 'scheduled' || s === 'expected');
      if (depTimeStr) {
        const depMs = new Date(depTimeStr).getTime();
        if (!isNaN(depMs)) {
          if (depMs >= now) {
            isUpcoming = true;
          }
          if (isUpcoming && (depMs - now) >= -300000) {
            const diff = Math.abs(depMs - now);
            if (diff < minFutureDiff) {
              minFutureDiff = diff;
              earliestUpcomingIdx = i;
            }
          }
        }
      } else if (isUpcoming && earliestUpcomingIdx === -1) {
        earliestUpcomingIdx = i;
      }
    }

    if (earliestUpcomingIdx !== -1) return earliestUpcomingIdx;

    // Rule 4: Fallback to segment with departure closest to current time
    let closestIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      const depTimeStr = getEndpointLocalTime(item.departure, TIME_PRECEDENCE.OPERATIONAL);
      if (depTimeStr) {
        const depMs = new Date(depTimeStr).getTime();
        if (!isNaN(depMs)) {
          const diff = Math.abs(depMs - now);
          if (diff < minDiff) {
            minDiff = diff;
            closestIdx = i;
          }
        }
      }
    }

    return closestIdx;
  }

  /**
   * Helper to format tab label for segment date selector (e.g., "Mon, Aug 24 (JFK-LAX)")
   */
  function formatSegmentTabLabel(item, index) {
    const depTimeStr = getEndpointLocalTime(item.departure, TIME_PRECEDENCE.OPERATIONAL);
    let dateStr = `Leg ${index + 1}`;
    if (depTimeStr) {
      try {
        const d = new Date(depTimeStr);
        if (!isNaN(d.getTime())) {
          const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
          const month = d.toLocaleDateString('en-US', { month: 'short' });
          const day = d.getDate();
          dateStr = `${weekday}, ${month} ${day}`;
        }
      } catch (e) {}
    }

    const depIata = item.departure?.airport?.iata || '';
    const arrIata = item.arrival?.airport?.iata || '';
    const route = (depIata && arrIata) ? ` (${depIata}-${arrIata})` : '';

    return `${dateStr}${route}`;
  }

  async function fetchFlightStatus(flightNumberInput, bypassCache = false) {
    // 1. Input Normalization
    const flightNumber = flightNumberInput.trim().toUpperCase().replace(/\s+/g, '');
    
    if (!flightNumber) {
      showAlert('Please enter a flight number (e.g. DL1193).', 'warning');
      return;
    }

    // 2. Validate API Key Presence
    if (!currentApiKey) {
      showAlert('API key missing! Please enter your RapidAPI key above to track flights. You can get a free key at RapidAPI.com.', 'warning');
      apiKeyInput.focus();
      return;
    }

    clearAlerts();

    // 3. Check Local Cache first (unless bypass requested)
    if (!bypassCache) {
      const cached = getCachedFlight(flightNumber);
      if (cached) {
        console.log(`[Cache Hit] Serving ${flightNumber} from localStorage cache. Age: ${cached.ageMinutes}m`);
        renderFlightResult(cached.data, flightNumber, true, cached);
        return;
      }
    }

    // 4. Cache miss or forced refresh: Execute API Request
    setLoadingState(true);

    try {
      const apiUrl = `https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(flightNumber)}?withAircraftImage=false&withLocation=false&withFlightPlan=false`;
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'x-rapidapi-host': 'aerodatabox.p.rapidapi.com',
          'x-rapidapi-key': currentApiKey
        }
      });

      if (response.status === 401 || response.status === 403) {
        showAlert('Invalid RapidAPI key or unauthorized access. Please check your RapidAPI key and AeroDataBox subscription on RapidAPI.com.', 'error');
        resultsContainer.classList.add('hidden');
        return;
      }

      if (response.status === 404 || response.status === 204) {
        showAlert(`No active or scheduled flight record found for flight number "${flightNumber}". Please verify the flight number.`, 'warning');
        resultsContainer.classList.add('hidden');
        return;
      }

      if (!response.ok) {
        throw new Error(`HTTP Error ${response.status}: ${response.statusText}`);
      }

      const json = await response.json();

      // Check if response contains valid flight data array
      if (!json || (Array.isArray(json) && json.length === 0)) {
        showAlert(`No active or scheduled flight record found for flight number "${flightNumber}". Please verify the flight number.`, 'warning');
        resultsContainer.classList.add('hidden');
        return;
      }

      // Successful fetch: Store in Local Cache
      setCachedFlight(flightNumber, json);
      
      // Render Live Result
      renderFlightResult(json, flightNumber, false, null);

    } catch (err) {
      console.error('Flight status request failed:', err);
      showAlert(`Network/API Connection Error: ${err.message}. Please check your internet connection or verify your RapidAPI key on RapidAPI.com.`, 'error');
      resultsContainer.classList.add('hidden');
    } finally {
      setLoadingState(false);
    }
  }

  /* ==========================================================================
     4. UI Rendering & Time Formatting Functions
     ========================================================================== */

  function setLoadingState(isLoading) {
    if (isLoading) {
      searchBtn.disabled = true;
      searchBtnText.textContent = 'Fetching...';
      searchSpinner.classList.remove('hidden');
    } else {
      searchBtn.disabled = false;
      searchBtnText.textContent = 'Track Flight';
      searchSpinner.classList.add('hidden');
    }
  }

  function showAlert(message, type = 'info') {
    clearAlerts();
    const alertEl = document.createElement('div');
    alertEl.className = `alert alert-${type}`;

    let iconSvg = '';
    if (type === 'error') {
      iconSvg = `<svg class="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;
    } else if (type === 'warning') {
      iconSvg = `<svg class="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
    } else {
      iconSvg = `<svg class="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
    }

    alertEl.innerHTML = `${iconSvg}<div>${message}</div>`;
    alertContainer.appendChild(alertEl);
  }

  function clearAlerts() {
    alertContainer.innerHTML = '';
  }

  /**
   * Helper to format time strings (ISO or space separated) as HH:mm
   */
  function formatTime(timeStr) {
    if (!timeStr) return '—';
    if (timeStr.includes('T')) {
      const timePart = timeStr.split('T')[1];
      if (timePart) {
        return timePart.substring(0, 5); // "HH:mm"
      }
    } else if (timeStr.includes(' ')) {
      const parts = timeStr.split(' ');
      if (parts.length >= 2) {
        return parts[1].substring(0, 5);
      }
    }
    return timeStr.length >= 5 ? timeStr.substring(0, 5) : timeStr;
  }

  /**
   * Extracts primary estimated time (actualTime > revisedTime > runwayTime > scheduledTime > predictedTime)
   * and compares with baseline scheduledTime.
   */
  function extractTimeDetails(endpointObj) {
    if (!endpointObj) {
      return { primaryFormatted: '—', schedFormatted: '—', isDifferent: false };
    }

    const schedRaw = endpointObj.scheduledTime?.local;
    const schedFormatted = formatTime(schedRaw);

    const primaryRaw = getEndpointLocalTime(endpointObj, TIME_PRECEDENCE.DISPLAY);
    const primaryFormatted = formatTime(primaryRaw);

    const isDifferent = (
      primaryFormatted !== '—' &&
      schedFormatted !== '—' &&
      primaryFormatted !== schedFormatted
    );

    return {
      primaryFormatted,
      schedFormatted,
      isDifferent
    };
  }

  /**
   * Formats departure terminal and gate info cleanly.
   * Only renders fields if present. If gate/terminal are missing, renders nothing.
   */
  function formatTerminalGatePair(terminal, gate) {
    const parts = [];
    if (terminal) parts.push(`Term ${terminal}`);
    if (gate) parts.push(`Gate ${gate}`);
    return parts.length > 0 ? parts.join(' • ') : '';
  }

  /**
   * Formats arrival terminal, gate, and baggage belt cleanly.
   * Only renders fields if present.
   */
  function formatArrivalTerminalGateBag(terminal, gate, baggageBelt) {
    const parts = [];
    if (terminal) parts.push(`Term ${terminal}`);
    if (gate) parts.push(`Gate ${gate}`);
    if (baggageBelt) parts.push(`Bag ${baggageBelt}`);
    return parts.length > 0 ? parts.join(' • ') : '';
  }

  function calculateFlightProgress(item) {
    if (!item) return 0;
    const status = (item.status || '').toLowerCase();
    if (status === 'landed' || status === 'arrived') return 100;
    if (status === 'scheduled' || status === 'expected' || status === 'cancelled') return 0;
    if (status === 'enroute' || status === 'boarding' || status === 'departed' || status === 'active' || status === 'in-flight') return 50;
    return 0;
  }

  function calculateDelay(item) {
    if (!item) return 0;
    for (const endpoint of [item.departure, item.arrival]) {
      const sched = endpoint?.scheduledTime?.local;
      const primary = getEndpointLocalTime(endpoint, TIME_PRECEDENCE.DELAY);
      if (sched && primary) {
        const sMs = new Date(sched).getTime();
        const pMs = new Date(primary).getTime();
        if (!isNaN(sMs) && !isNaN(pMs)) {
          const diff = Math.round((pMs - sMs) / 60000);
          if (diff > 0) return diff;
        }
      }
    }
    return 0;
  }

  function getStatusStyle(statusRaw, delayMins) {
    const s = (statusRaw || '').toLowerCase();
    if (s === 'enroute' || s === 'boarding' || s === 'active' || s === 'en-route' || s === 'departed' || s === 'in-flight') {
      return { class: 'status-active', label: statusRaw ? statusRaw.toUpperCase() : 'EN ROUTE' };
    } else if (s === 'landed' || s === 'arrived') {
      return { class: 'status-landed', label: 'LANDED' };
    } else if (s === 'scheduled' || s === 'expected') {
      return { class: 'status-scheduled', label: statusRaw ? statusRaw.toUpperCase() : 'SCHEDULED' };
    } else if (s === 'cancelled' || s === 'canceled') {
      return { class: 'status-cancelled', label: 'CANCELLED' };
    } else if (delayMins > 0 || s === 'delayed') {
      return { class: 'status-delayed', label: 'DELAYED' };
    }
    return { class: 'status-scheduled', label: statusRaw ? statusRaw.toUpperCase() : 'UNKNOWN' };
  }

  function renderFlightResult(apiResponse, flightNumber, isCached, cacheInfo, selectedSegmentIndex = null) {
    const isArray = Array.isArray(apiResponse);
    const totalSegments = isArray ? apiResponse.length : 1;
    
    // Determine active segment index
    let targetIndex = 0;
    if (isArray && totalSegments > 0) {
      if (selectedSegmentIndex !== null && selectedSegmentIndex !== undefined && selectedSegmentIndex >= 0 && selectedSegmentIndex < totalSegments) {
        targetIndex = selectedSegmentIndex;
      } else {
        targetIndex = getSmartDefaultSegmentIndex(apiResponse);
      }
    }

    const item = isArray ? apiResponse[targetIndex] : apiResponse;
    if (!item) return;

    const delayMins = calculateDelay(item);
    const statusMeta = getStatusStyle(item.status, delayMins);
    const progressPct = calculateFlightProgress(item);

    const airlineName = item.airline?.name || 'Airline';
    const flightNum = item.number || flightNumber;
    const aircraftModel = item.aircraft?.model || '—';

    // Departure details
    const depIata = item.departure?.airport?.iata || 'DEP';
    const depCity = item.departure?.airport?.municipalityName || item.departure?.airport?.name || 'Origin';
    const depTimes = extractTimeDetails(item.departure);
    const depGateInfo = formatTerminalGatePair(item.departure?.terminal, item.departure?.gate);

    const depSubtextHtml = depTimes.isDifferent
      ? `Sched: <s>${depTimes.schedFormatted}</s>`
      : `Sched: ${depTimes.schedFormatted}`;

    // Arrival details
    const arrIata = item.arrival?.airport?.iata || 'ARR';
    const arrCity = item.arrival?.airport?.municipalityName || item.arrival?.airport?.name || 'Destination';
    const arrTimes = extractTimeDetails(item.arrival);
    const arrGateInfo = formatArrivalTerminalGateBag(item.arrival?.terminal, item.arrival?.gate, item.arrival?.baggageBelt);

    const arrSubtextHtml = arrTimes.isDifferent
      ? `Sched: <s>${arrTimes.schedFormatted}</s>`
      : `Sched: ${arrTimes.schedFormatted}`;

    // Render Segment Selector Tabs if multiple segments exist
    let segmentTabsHtml = '';
    if (isArray && totalSegments > 1) {
      const tabButtonsHtml = apiResponse.map((seg, idx) => {
        const label = formatSegmentTabLabel(seg, idx);
        const isActive = (idx === targetIndex);
        const s = (seg.status || '').toLowerCase();
        const isLiveActive = (s === 'enroute' || s === 'boarding' || s === 'active' || s === 'in-flight');
        return `
          <button type="button" class="segment-tab-btn ${isActive ? 'active' : ''}" data-index="${idx}">
            <span class="segment-status-dot ${isLiveActive ? 'dot-active' : ''}"></span>
            <span>${label}</span>
          </button>
        `;
      }).join('');

      segmentTabsHtml = `
        <div class="segment-tabs-container">
          ${tabButtonsHtml}
        </div>
      `;
    }

    // Cache banner markup
    let cacheBannerHtml = '';
    if (isCached && cacheInfo) {
      const ageText = cacheInfo.ageMinutes === 0 ? 'less than a minute ago' : `${cacheInfo.ageMinutes} minute${cacheInfo.ageMinutes > 1 ? 's' : ''} ago`;
      cacheBannerHtml = `
        <div class="cache-info-banner">
          <div>
            ⚡ <strong>Served from local browser cache</strong> (Fetched ${ageText} • Expires in ~${cacheInfo.remainingMinutes} min)
          </div>
          <button type="button" class="btn-force-refresh" id="forceRefreshBtn" data-flight="${flightNumber}">
            Fetch Fresh Data ↻
          </button>
        </div>
      `;
    } else {
      cacheBannerHtml = `
        <div class="cache-info-banner is-live">
          <div>
            🟢 <strong>Live data fetched directly from AeroDataBox API</strong> (Cached for 10 minutes)
          </div>
        </div>
      `;
    }

    const html = `
      ${segmentTabsHtml}

      <div class="flight-card">
        <!-- Card Header -->
        <div class="flight-header-row">
          <div class="airline-flight-info">
            <span class="airline-name">${airlineName} • ${flightNum}</span>
            <h1 class="flight-number-lg">${flightNum}</h1>
          </div>
          <div class="status-cache-pills">
            <span class="status-pill ${statusMeta.class}">
              <span class="pill-dot"></span>
              ${statusMeta.label}
            </span>
            ${isCached ? '<span class="cache-badge cache-badge-cached">⚡ Cached (10m TTL)</span>' : '<span class="cache-badge cache-badge-live">🟢 Live Request</span>'}
          </div>
        </div>

        <!-- Cache Info Banner -->
        ${cacheBannerHtml}

        <!-- Departure -> Arrival Visual Timeline -->
        <div class="route-timeline">
          <!-- Departure -->
          <div class="endpoint endpoint-dep">
            <div class="iata-code">${depIata}</div>
            <div class="city-name" title="${depCity}">${depCity}</div>
            <div class="time-box">
              <span class="time-main">${depTimes.primaryFormatted}</span>
              <span class="time-sub">${depSubtextHtml}</span>
            </div>
            ${depGateInfo ? `<div class="terminal-gate">${depGateInfo}</div>` : ''}
          </div>

          <!-- Progress Bar Line -->
          <div class="flight-path">
            <div class="path-line-container">
              <div class="path-line-bg"></div>
              <div class="path-line-progress" style="width: ${progressPct}%;"></div>
              <div class="airplane-icon-wrapper" style="left: ${progressPct}%;">
                <svg class="airplane-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
                </svg>
              </div>
            </div>
            <span class="duration-text">
              ${progressPct}% completed
            </span>
          </div>

          <!-- Arrival -->
          <div class="endpoint endpoint-arr">
            <div class="iata-code">${arrIata}</div>
            <div class="city-name" title="${arrCity}">${arrCity}</div>
            <div class="time-box">
              <span class="time-main">${arrTimes.primaryFormatted}</span>
              <span class="time-sub">${arrSubtextHtml}</span>
            </div>
            ${arrGateInfo ? `<div class="terminal-gate">${arrGateInfo}</div>` : ''}
          </div>
        </div>

        <!-- Metric Grid -->
        <div class="metrics-grid">
          <!-- Delay Status -->
          <div class="metric-card">
            <div class="metric-icon-bg">
              <svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
            </div>
            <div class="metric-content">
              <span class="metric-label">Delay Status</span>
              <span class="metric-value ${delayMins > 0 ? 'metric-delayed' : 'metric-ontime'}">
                ${delayMins > 0 ? '+' + delayMins + ' min delay' : 'On Time'}
              </span>
              <span class="metric-subtext">${item.status || 'Status Active'}</span>
            </div>
          </div>

          <!-- Aircraft Model -->
          <div class="metric-card">
            <div class="metric-icon-bg">
              <svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3.5s-2.5 0-4 1.5L13.5 8.5 5.3 6.7c-.6-.1-1.2.1-1.5.6l-.9.9c-.4.4-.3 1.1.2 1.4l5.2 3.6-3.4 3.4-2.4-.6c-.4-.1-.8.1-1 .4l-.4.4c-.3.3-.2.8.2 1l2.8 1.4 1.4 2.8c.2.4.7.5 1 .2l.4-.4c.3-.2.5-.6.4-1l-.6-2.4 3.4-3.4 3.6 5.2c.3.5 1 .6 1.4.2l.9-.9c.5-.3.7-.9.6-1.5z"></path>
              </svg>
            </div>
            <div class="metric-content">
              <span class="metric-label">Aircraft Model</span>
              <span class="metric-value">${aircraftModel}</span>
              <span class="metric-subtext">${item.aircraft?.reg ? 'Tail: ' + item.aircraft.reg : 'Aircraft Info'}</span>
            </div>
          </div>
        </div>

        <!-- Technical Payload Inspector (Accordion) -->
        <details class="tech-details-details">
          <summary class="tech-details-summary">
            <span>Developer View: AeroDataBox Raw API JSON Response</span>
            <span>▼</span>
          </summary>
          <div class="json-preview-container">
            <button type="button" id="copyJsonBtn" class="btn-copy-json" title="Copy JSON to clipboard">
              <svg class="icon-copy" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              <span id="copyJsonBtnText">Copy JSON</span>
            </button>
            <pre class="raw-json-block">${JSON.stringify(apiResponse, null, 2)}</pre>
          </div>
        </details>
      </div>
    `;

    resultsContainer.innerHTML = html;
    resultsContainer.classList.remove('hidden');

    // Attach event listeners for Segment Tab buttons
    document.querySelectorAll('.segment-tab-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const clickedIdx = parseInt(e.currentTarget.dataset.index, 10);
        renderFlightResult(apiResponse, flightNumber, isCached, cacheInfo, clickedIdx);
      });
    });

    // Attach event listener for Copy JSON button
    const copyJsonBtn = document.getElementById('copyJsonBtn');
    if (copyJsonBtn) {
      copyJsonBtn.addEventListener('click', () => {
        const rawJsonText = JSON.stringify(apiResponse, null, 2);
        navigator.clipboard.writeText(rawJsonText).then(() => {
          const btnText = document.getElementById('copyJsonBtnText');
          if (btnText) btnText.textContent = 'Copied!';
          copyJsonBtn.classList.add('copied');
          setTimeout(() => {
            if (btnText) btnText.textContent = 'Copy JSON';
            copyJsonBtn.classList.remove('copied');
          }, 2000);
        }).catch((err) => {
          console.error('Failed to copy JSON:', err);
        });
      });
    }

    // Attach event listener for Force Refresh button if rendered
    const forceRefreshBtn = document.getElementById('forceRefreshBtn');
    if (forceRefreshBtn) {
      forceRefreshBtn.addEventListener('click', (e) => {
        const targetFlight = e.currentTarget.dataset.flight;
        fetchFlightStatus(targetFlight, true); // true = bypassCache
      });
    }
  }

  /* ==========================================================================
     5. Event Listeners Setup
     ========================================================================== */

  function setupEventListeners() {
    // Save API Key Form
    apiKeyForm.addEventListener('submit', (e) => {
      e.preventDefault();
      saveApiKey(apiKeyInput.value);
    });

    // Toggle API Key Mask Visibility
    toggleKeyVisibilityBtn.addEventListener('click', () => {
      const currentType = apiKeyInput.getAttribute('type');
      if (currentType === 'password') {
        apiKeyInput.setAttribute('type', 'text');
        toggleKeyVisibilityBtn.style.color = 'var(--primary-blue)';
      } else {
        apiKeyInput.setAttribute('type', 'password');
        toggleKeyVisibilityBtn.style.color = 'var(--text-secondary)';
      }
    });

    // Edit API Key Button
    editApiKeyBtn.addEventListener('click', () => {
      apiKeyActiveView.classList.add('hidden');
      apiKeyForm.classList.remove('hidden');
      apiKeyInput.value = currentApiKey;
      apiKeyInput.focus();
    });

    // Clear API Key Button
    clearApiKeyBtn.addEventListener('click', () => {
      if (confirm('Are you sure you want to clear your stored RapidAPI key?')) {
        clearApiKey();
      }
    });

    // Flight Search Form Submission
    flightSearchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      fetchFlightStatus(flightInput.value);
    });

    // Auto Upper-case typing in Flight Number input
    flightInput.addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase();
    });

    // Sample Flight Chips
    document.querySelectorAll('.chip-sample').forEach((chip) => {
      chip.addEventListener('click', () => {
        const flightCode = chip.dataset.flight;
        flightInput.value = flightCode;
        fetchFlightStatus(flightCode);
      });
    });
  }

  // Kickstart on DOM Load
  document.addEventListener('DOMContentLoaded', init);
})();
