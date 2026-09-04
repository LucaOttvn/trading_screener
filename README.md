# Market movements screener


## Imports and setup


```js
import express from "express";
import YahooFinance from "yahoo-finance2";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
```


- **express** — HTTP server and routing.
- **yahoo-finance2** — Community-maintained wrapper around Yahoo Finance’s unofficial API. It handles cookies/crumbs internally and exposes **quote()** and **chart()** methods.
- **fs, url, path** — Node utilities to read **symbols.json** and compute directories in an ESM-compatible way.


```js
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
```


Required in ESM to replicate CommonJS’s **__filename** and **__dirname**.


## Yahoo Finance client


```js
const yf = new YahooFinance({
  validation: {
    logErrors: false,
    logOptionsErrors: false,
  },
});
```


## Paths and categories


```js
const PORT = process.env.PORT || 3000;
const SYMBOLS_FILE = join(__dirname, "../src/symbols.json");
const STATIC_DIR = join(__dirname, "../src");
```


- **PORT** — Uses Vercel’s environment variable or defaults to **3000** for local development.
- **SYMBOLS_FILE** — Path to the JSON file that defines which instruments to track.
- **STATIC_DIR** — Directory served as static files (HTML, CSS, JS).


```js
const CATEGORIES = {
  forex: { label: "Forex", threshold: 0.05 },
  stocks: { label: "Stocks", threshold: 2 },
  indices: { label: "Indices", threshold: 0.1 },
  "raw-materials": { label: "Raw materials", threshold: 0.1 },
  crypto: { label: "Crypto", threshold: 0.5 },
};
```


## Utility functions


```js
const round = (number, decimals = 3) => {
  if (number == null || !Number.isFinite(number)) {
    return null;
  }

  return Number(number.toFixed(decimals));
};
```


Safely rounds numeric values from Yahoo Finance, returning **null** for invalid inputs.


```js
function formatPercentage(value) {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }

  const sign = value > 0 ? "+" : "";

  return `${sign}${value.toFixed(2)}%`;
}
```


Converts a numeric percentage (e.g. **-0.03**) into a display string (**"-0.03%"**).

## Threshold parsing from query string


These functions allow the frontend to override default thresholds via URL parameters.


```js
function getThreshold(value, fallback) {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue)) {
    return fallback;
  }

  return Math.min(Math.max(parsedValue, 0), 100);
}
```


Converts the incoming string to a number.


Clamps it between **0** and **100** to avoid absurd values.


- Falls back to the default if invalid.


```js
function getThresholds(query) {
  return Object.fromEntries(
    Object.entries(CATEGORIES).map(([category, config]) => {
      const queryValue = query[`threshold_${category}`];

      return [
        category,
        getThreshold(queryValue, config.threshold),
      ];
    })
  );
}
```


Reads query parameters like **threshold_forex**, **threshold_stocks**, etc.


Returns an object:


```js
{
  forex: 0.1,
  stocks: 3,
  indices: 0.25,
  "raw-materials": 0.5,
  crypto: 1,
}
```


## Fetching data for a single instrument


```js
async function fetchSymbolData(category, symbol, label, threshold) {
  const quote = await yf.quote(symbol);
  const changePercent = quote.regularMarketChangePercent;

  if (
    changePercent == null ||
    !Number.isFinite(changePercent)
  ) {
    return null;
  }

  const absoluteChangePercent = Math.abs(changePercent);

  if (absoluteChangePercent >= threshold) {
    return null;
  }

  return {
    symbol,
    label: label || symbol,
    change_percentage: round(changePercent, 3),
    formatted_change_percentage: formatPercentage(changePercent),
  };
}
```


Calls **`yf.quote(symbol)`** to get the latest quote snapshot from Yahoo Finance.


- Extracts **`regularMarketChangePercent`**, which is the signed daily percentage change.
- If the absolute movement is greater than or equal to the threshold, the function returns **null** (the instrument is excluded).


Otherwise, it returns a small object with:


- **symbol**
- **label**
- **change_percentage** (numeric)
- **formatted_change_percentage** (string, e.g. **"-0.03%"**)


This implements the core rule: “show instruments moving less than the chosen threshold.”


## Generating full market data


```js
async function generateMarketData(thresholds) {
  const symbolsByCategory = readSymbols();

  const results = Object.fromEntries(
    Object.keys(CATEGORIES).map((category) => [category, []])
  );

  const errors = [];

  for (const [category, instruments] of Object.entries(symbolsByCategory)) {
    for (const item of instruments) {
      const symbol = typeof item === "string"
        ? item
        : item.symbol;

      const label = typeof item === "string"
        ? item
        : item.label;

      if (!symbol) {
        continue;
      }

      try {
        const result = await fetchSymbolData(
          category,
          symbol,
          label,
          thresholds[category]
        );

        if (result) {
          results[category].push(result);
        }
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : String(error);

        console.warn(
          `[Yahoo error] ${label || symbol} (${symbol}): ${message}`
        );

        errors.push({
          category,
          symbol,
          label: label || symbol,
          message,
        });
      }
    }

    results[category].sort(
      (a, b) =>
        Math.abs(b.change_percentage) -
        Math.abs(a.change_percentage)
    );
  }

  return {
    generated_at: new Date().toISOString(),
    movement_reference: "regularMarketPreviousClose",
    categories: Object.fromEntries(
      Object.entries(CATEGORIES).map(([category, config]) => [
        category,
        {
          label: config.label,
          threshold: thresholds[category],
          symbols: results[category],
          count: results[category].length,
        },
      ])
    ),
    errors,
  };
}
```


- Reads the configured symbols.
- Iterates over every category and instrument.
- Calls **fetchSymbolData** with the per-category threshold coming from the query string.


Outcomes:


- **results[category]** — Instruments that passed the threshold filter.
- **errors** — Any symbols that failed to load.
- Sorts each category by absolute movement so the most volatile instruments within the threshold appear first.
- Returns a structured JSON object used by the frontend.


## API route


```js
app.get("/api/ranges", async (request, response) => {
  try {
    const thresholds = getThresholds(request.query);
    const data = await generateMarketData(thresholds);

    response.setHeader(
      "Cache-Control",
      "no-store, max-age=0"
    );

    response.status(200).json(data);
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : String(error);

    console.error("[API error]", message);

    response.status(500).json({
      error: message,
    });
  }
});
```


- Reads thresholds from **request.query** (e.g. **`?threshold_stocks=3`**).
- Calls **generateMarketData(thresholds)**.
- Disables caching to ensure fresh data on each refresh.


Returns JSON on success, or a simple error object on failure.


## Static files and local server


```js
app.use(express.static(STATIC_DIR));
```


Serves **src/index.html**, **src/style.css**, and **src/screener.js** as static assets.


```js
const filePath = process.argv[1];

const isMain =
  Boolean(filePath) &&
  fileURLToPath(import.meta.url) === resolve(filePath);

if (isMain) {
  app.listen(PORT, () => {
    console.log(`[screener] → http://localhost:${PORT}`);
  });
}
```


- Detects whether this file is the main entry point.
- If run directly (**`node api/index.js`**), starts an HTTP server.
- On Vercel, this block is ignored; Vercel imports the module and handles requests via its own runtime.


## Export for Vercel


```js
export default app;
```


Exports the Express app so Vercel can mount it as a serverless function.


## `src/index.html`


The main HTML page. Minimal structure with semantic sections.


### Head


```html
<head>
  <meta charset="UTF-8" />
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  />
  <title>Market movements</title>
  <link rel="stylesheet" href="./style.css" />
</head>
```


- Sets UTF-8 encoding and a responsive viewport.
- Links the stylesheet.


## Main layout


```html
<main>
  <header class="page-header">
    <div>
      <p class="eyebrow">Yahoo Finance screener</p>
      <h1>Market movements</h1>
      <p id="updated">Loading data...</p>
    </div>

    <button id="refresh-button" type="button">
      Refresh
    </button>
  </header>
```


**page-header** contains:


- A small eyebrow label.
- The main title.
- A timestamp paragraph (**#updated**) that shows when the data was last fetched.
- A **Refresh** button that re-fetches data using the current thresholds.


## Threshold settings section


```html
<section class="settings">
  <div>
    <h2>Thresholds</h2>
    <p>
      Show instruments moving less than the selected daily percentage.
    </p>
  </div>

  <form id="threshold-form" class="threshold-form">
    <div id="threshold-inputs" class="threshold-inputs"></div>

    <div class="threshold-actions">
      <button
        id="reset-button"
        type="button"
        class="secondary-button"
      >
        Reset defaults
      </button>

      <button type="submit">
        Apply thresholds
      </button>
    </div>
  </form>
</section>
```


- **#threshold-inputs** is populated dynamically by **screener.js** with five numeric inputs, one per category.
- On submit, the form reads the values, saves them to **localStorage**, and reloads data.
- **Reset defaults** restores the default thresholds and reloads data.


## Status and results


```html
<section
  id="status"
  class="status"
  aria-live="polite"
>
  Loading market data...
</section>

<div id="categories"></div>
<div id="errors"></div>
```


- **#status** — Shows loading, success, or error messages.
- **#categories** — Filled with one **.category** section per market category.
- **#errors** — Filled with a list of symbols that failed to load.


## Script


```html
<script src="./screener.js"></script>
```


Loads the frontend logic.


## `src/style.css`


Defines a clean, light-themed UI with responsive behavior.


### Global styles


```css
:root {
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
    "Segoe UI", sans-serif;
  color: #1f2937;
  background: #f8fafc;
  color-scheme: light;
}

* {
  box-sizing: border-box;
}

body {
  min-width: 320px;
  margin: 0;
  background: linear-gradient(
    180deg,
    #eff6ff 0,
    #f8fafc 320px,
    #f8fafc 100%
  );
}
```


Uses system fonts with a preference for Inter, sets a light background and dark text, ensures consistent box sizing, and adds a subtle top gradient.


## Layout


```css
main {
  width: min(900px, calc(100% - 32px));
  margin: 0 auto;
  padding: 40px 0 56px;
}
```


Centers the content with a maximum width and horizontal padding.


## Page header


```css
.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 24px;
}
```


Flex layout with space between the title block and refresh button.


Typography styles for **.eyebrow**, **h1**, and **#updated** control size, color, and spacing.


## Buttons


```css
#refresh-button {
  padding: 10px 14px;
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  background: #ffffff;
  color: #1d4ed8;
  font: inherit;
  font-size: 0.875rem;
  font-weight: 700;
  cursor: pointer;
  transition:
    background 160ms ease,
    border-color 160ms ease,
    color 160ms ease,
    transform 160ms ease;
}
```


- Default state: white background, blue text, and blue border.
- Hover: blue background and white text.
- Active: slight downward movement.
- Disabled: reduced opacity and non-interactive cursor.


## Settings section


```css
.settings {
  display: grid;
  gap: 20px;
  margin-bottom: 20px;
  padding: 18px;
  border: 1px solid #dbe3ee;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 8px 24px rgb(15 23 42 / 4%);
}
```


Card-like container for thresholds.


### Threshold inputs grid


```css
.threshold-inputs {
  display: grid;
  grid-template-columns: repeat(5, minmax(120px, 1fr));
  gap: 12px;
}
```


Five columns on desktop, fewer on smaller screens (see media queries).


### Individual input styling


```css
.threshold-field input {
  width: 100%;
  padding: 9px 30px 9px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 7px;
  outline: none;
  color: #111827;
  background: #ffffff;
  font: inherit;
  font-size: 0.875rem;
}

.threshold-field input:focus {
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgb(37 99 235 / 12%);
}
```


Clean input with a focus ring.


### Percentage sign overlay


```css
.threshold-unit {
  position: absolute;
  top: 50%;
  right: 10px;
  color: #6b7280;
  font-size: 0.8rem;
  pointer-events: none;
  transform: translateY(-50%);
}
```


## Status and categories


```css
.status {
  padding: 14px 16px;
  border: 1px solid #dbe3ee;
  border-radius: 10px;
  background: #ffffff;
  color: #6b7280;
  font-size: 0.9rem;
}

.status.is-error {
  border-color: #fecaca;
  background: #fff1f2;
  color: #b91c1c;
}
```


Neutral style by default, red-tinted when an error occurs.


### Category cards


```css
.category {
  overflow: hidden;
  border: 1px solid #dbe3ee;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 8px 24px rgb(15 23 42 / 6%);
}
```


## Table


```css
.market-table {
  width: 100%;
  border-collapse: collapse;
}

.market-table th {
  padding: 11px 18px;
  border-bottom: 1px solid #e5e7eb;
  background: #f8fafc;
  color: #6b7280;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.07em;
  text-align: right;
  text-transform: uppercase;
}

.market-table th:first-child {
  text-align: left;
}

.market-table td {
  padding: 14px 18px;
  border-bottom: 1px solid #eef2f7;
  color: #374151;
  font-size: 0.9rem;
  text-align: right;
}

.market-table td:first-child {
  text-align: left;
}
```


- First column (instrument name) is left-aligned; the movement column is right-aligned.
- Rows have a subtle hover effect.


### Instrument label and symbol


```css
.instrument-label {
  display: block;
  overflow: hidden;
  max-width: 360px;
  color: #111827;
  font-weight: 750;
  text-overflow: ellipsis;
}

.instrument-symbol {
  display: block;
  margin-top: 3px;
  color: #6b7280;
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.75rem;
}
```


### Movement badges


```css
.movement {
  display: inline-block;
  min-width: 78px;
  padding: 6px 9px;
  border-radius: 6px;
  font-size: 0.82rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.is-positive {
  background: #dcfce7;
  color: #15803d;
}

.is-negative {
  background: #fee2e2;
  color: #dc2626;
}

.is-neutral {
  background: #f1f5f9;
  color: #475569;
}
```


- Positive movements: green badge.
- Negative movements: red badge.
- Neutral: gray badge.


## Errors


```css
.errors {
  margin-top: 24px;
  padding: 16px 18px;
  border: 1px solid #fecaca;
  border-radius: 10px;
  background: #fff1f2;
  color: #b91c1c;
}
```


Red-tinted box listing failed symbols.


## Responsive behavior


Media queries adjust:


- Main width and padding.
- Header layout (column on small screens).
- Number of threshold input columns (**5 → 2 → 1**).
- Button widths on very small screens.


## `src/screener.js`


Frontend logic for thresholds, data fetching, and rendering.


## Element references and constants


```js
const categoriesElement = document.querySelector("#categories");
const errorsElement = document.querySelector("#errors");
const statusElement = document.querySelector("#status");
const updatedElement = document.querySelector("#updated");
const refreshButton = document.querySelector("#refresh-button");

const thresholdForm = document.querySelector("#threshold-form");
const thresholdInputsElement = document.querySelector("#threshold-inputs");
const resetButton = document.querySelector("#reset-button");

const STORAGE_KEY = "market-screener-thresholds";
```


Caches DOM elements and defines the **localStorage** key.


## Default thresholds and labels


```js
const DEFAULT_THRESHOLDS = {
  forex: 0.05,
  stocks: 2,
  indices: 0.1,
  "raw-materials": 0.1,
  crypto: 0.5,
};

const CATEGORY_LABELS = {
  forex: "Forex",
  stocks: "Stocks",
  indices: "Indices",
  "raw-materials": "Raw materials",
  crypto: "Crypto",
};
```


Mirrors the backend categories so the UI can generate inputs and labels dynamically.


## Utilities


```js
function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
```


Prevents XSS by escaping user-visible text from the API.


## LocalStorage helpers


```js
function getSavedThresholds() {
  try {
    const savedThresholds = JSON.parse(
      localStorage.getItem(STORAGE_KEY)
    );

    if (
      !savedThresholds ||
      typeof savedThresholds !== "object"
    ) {
      return { ...DEFAULT_THRESHOLDS };
    }

    return {
      ...DEFAULT_THRESHOLDS,
      ...savedThresholds,
    };
  } catch {
    return { ...DEFAULT_THRESHOLDS };
  }
}

function saveThresholds(thresholds) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(thresholds)
  );
}
```


- **getSavedThresholds** — Safely reads stored thresholds, merging with defaults.
- **saveThresholds** — Persists the current thresholds.


## Rendering threshold inputs


```js
function renderThresholdInputs(thresholds) {
  thresholdInputsElement.innerHTML = Object.entries(
    DEFAULT_THRESHOLDS
  )
    .map(([category, defaultValue]) => {
      const threshold = thresholds[category] ?? defaultValue;
      const label = CATEGORY_LABELS[category] || category;

      return `
        <div class="threshold-field">
          <label for="threshold-${escapeHtml(category)}">
            ${escapeHtml(label)}
          </label>

          <div class="threshold-input-wrapper">
            <input
              id="threshold-${escapeHtml(category)}"
              name="${escapeHtml(category)}"
              type="number"
              min="0"
              max="100"
              step="0.01"
              value="${escapeHtml(threshold)}"
              required
            />

            <span class="threshold-unit">%</span>
          </div>
        </div>
      `;
    })
    .join("");
}
```


Generates five labeled numeric inputs, one per category, with the current threshold value.


## Reading thresholds from the form


```js
function getThresholdsFromForm() {
  const formData = new FormData(thresholdForm);

  return Object.fromEntries(
    Object.entries(DEFAULT_THRESHOLDS).map(
      ([category, fallback]) => {
        const rawValue = formData.get(category);
        const numericValue = Number(rawValue);

        const threshold = Number.isFinite(numericValue)
          ? Math.min(Math.max(numericValue, 0), 100)
          : fallback;

        return [category, threshold];
      }
    )
  );
}
```


- Reads each input by **name**.
- Clamps values between **0** and **100**.
- Falls back to defaults on invalid input.


## Movement classification


```js
function movementClass(changePercentage) {
  if (changePercentage > 0) {
    return "is-positive";
  }

  if (changePercentage < 0) {
    return "is-negative";
  }

  return "is-neutral";
}
```


Used to assign CSS classes for green/red/neutral styling.


## Date formatting


```js
function formatDate(dateString) {
  if (!dateString) {
    return "Last update unavailable";
  }

  const date = new Date(dateString);

  if (Number.isNaN(date.getTime())) {
    return "Last update unavailable";
  }

  return `Updated ${new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(date)}`;
}
```


Formats the **generated_at** timestamp from the API.


## Rendering rows and categories


```js
function renderSymbolRow(instrument) {
  const movementStyle = movementClass(
    instrument.change_percentage
  );

  return `
    <tr>
      <td>
        <span class="instrument-label">
          ${escapeHtml(instrument.label)}
        </span>

        <span class="instrument-symbol">
          ${escapeHtml(instrument.symbol)}
        </span>
      </td>

      <td>
        <span class="movement ${movementStyle}">
          ${escapeHtml(
            instrument.formatted_change_percentage || "—"
          )}
        </span>
      </td>
    </tr>
  `;
}
```


Creates a table row with instrument name/symbol and a colored movement badge.


```js
function renderCategory(category) {
  const { label, threshold, count, symbols } = category;

  const content =
    symbols.length === 0
      ? `
        <p class="empty">
          No instruments currently match this threshold.
        </p>
      `
      : `
        <table class="market-table">
          <thead>
            <tr>
              <th scope="col">Instrument</th>
              <th scope="col">Today</th>
            </tr>
          </thead>

          <tbody>
            ${symbols.map(renderSymbolRow).join("")}
          </tbody>
        </table>
      `;

  return `
    <section class="category">
      <header class="category-header">
        <div>
          <h2 class="category-title">
            ${escapeHtml(label)}
          </h2>

          <span class="category-threshold">
            Movement below ${escapeHtml(threshold)}%
          </span>
        </div>

        <span
          class="category-count"
          title="${escapeHtml(count)} matching instruments"
        >
          ${escapeHtml(count)}
        </span>
      </header>

      ${content}
    </section>
  `;
}
```


Renders each category card with:


- Title and threshold description.
- Count badge.
- Table of instruments or an empty-state message.


## Error rendering


```js
function renderErrors(errors) {
  if (!Array.isArray(errors) || errors.length === 0) {
    errorsElement.innerHTML = "";
    return;
  }

  errorsElement.innerHTML = `
    <section class="errors">
      <h2>Some symbols could not be loaded</h2>

      <ul>
        ${errors
          .map(
            (error) => `
              <li>
                <strong>
                  ${escapeHtml(error.label || error.symbol)}
                </strong>
                (${escapeHtml(error.symbol)}):
                ${escapeHtml(error.message)}
              </li>
            `
          )
          .join("")}
      </ul>
    </section>
  `;
}
```


Displays a list of symbols that failed to load, with their error messages.


## Loading state and data fetching


```js
function setLoadingState(isLoading) {
  refreshButton.disabled = isLoading;
  resetButton.disabled = isLoading;

  refreshButton.textContent = isLoading
    ? "Refreshing..."
    : "Refresh";
}
```


Disables buttons and updates text while data is loading.


```js
async function loadMarketData(thresholds) {
  setLoadingState(true);

  statusElement.classList.remove("is-error");
  statusElement.textContent = "Loading market data...";

  try {
    const searchParams = new URLSearchParams();

    Object.entries(thresholds).forEach(
      ([category, threshold]) => {
        searchParams.set(
          `threshold_${category}`,
          String(threshold)
        );
      }
    );

    const response = await fetch(
      `/api/ranges?${searchParams.toString()}`,
      {
        cache: "no-store",
      }
    );

    if (!response.ok) {
      throw new Error(
        `The server returned HTTP ${response.status}.`
      );
    }

    const data = await response.json();

    categoriesElement.innerHTML = Object.values(
      data.categories || {}
    )
      .map(renderCategory)
      .join("");

    updatedElement.textContent = formatDate(data.generated_at);

    statusElement.textContent =
      "Showing current daily movement relative to the previous market close.";

    renderErrors(data.errors);
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "An unknown error occurred.";

    categoriesElement.innerHTML = "";
    errorsElement.innerHTML = "";

    updatedElement.textContent = "Data could not be updated.";

    statusElement.classList.add("is-error");
    statusElement.textContent =
      `Unable to load market data: ${message}`;
  } finally {
    setLoadingState(false);
  }
}
```


Builds a query string from the thresholds object.


Calls **`/api/ranges?threshold_forex=...&threshold_stocks=...`**.


On success:


- Renders categories.
- Updates the timestamp.
- Shows any errors.


On failure:


- Clears categories.
- Displays an error message in the status bar.


## Event listeners and initialization


```js
thresholdForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const thresholds = getThresholdsFromForm();

  saveThresholds(thresholds);
  loadMarketData(thresholds);
});
```


When the user clicks **Apply thresholds**:


- Reads values from the form.
- Saves them to **localStorage**.
- Reloads data with the new thresholds.


```js
refreshButton.addEventListener("click", () => {
  const thresholds = getThresholdsFromForm();

  saveThresholds(thresholds);
  loadMarketData(thresholds);
});
```


The Refresh button does the same, but conceptually means “reload now.”


```js
resetButton.addEventListener("click", () => {
  const thresholds = { ...DEFAULT_THRESHOLDS };

  saveThresholds(thresholds);
  renderThresholdInputs(thresholds);
  loadMarketData(thresholds);
});
```


Restores default thresholds, re-renders inputs, and reloads data.


```js
const initialThresholds = getSavedThresholds();

renderThresholdInputs(initialThresholds);
loadMarketData(initialThresholds);
```


On page load:


- Reads saved thresholds (or defaults).
- Renders the threshold inputs.
- Fetches and displays market data.


## `src/symbols.json`


Configuration file listing instruments by category.


Example:


```json
{
  "forex": [
    { "symbol": "EURUSD=X", "label": "EUR/USD" },
    { "symbol": "GBPUSD=X", "label": "GBP/USD" }
  ],
  "stocks": [
    { "symbol": "AAPL", "label": "Apple" },
    { "symbol": "MSFT", "label": "Microsoft" }
  ],
  "indices": [
    { "symbol": "^GSPC", "label": "S&P 500" }
  ],
  "raw-materials": [
    { "symbol": "GC=F", "label": "Gold" },
    { "symbol": "CL=F", "label": "Crude Oil" }
  ],
  "crypto": [
    { "symbol": "BTC-USD", "label": "Bitcoin" },
    { "symbol": "ETH-USD", "label": "Ethereum" }
  ]
}
```


Each category is an array.


Items can be:


- Simple strings: **"AAPL"** (the label defaults to the symbol).
- Objects: **`{ "symbol": "AAPL", "label": "Apple" }`**.


The backend normalizes this structure in **readSymbols()**.


## `package.json`


Minimal configuration:


```json
{
  "name": "market-screener",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node api/index.js",
    "dev": "node --watch api/index.js"
  },
  "dependencies": {
    "express": "^4.21.2",
    "yahoo-finance2": "^2.12.0"
  }
}
```


- **"type": "module"** enables ESM syntax (**import/export**).
- **start** runs the server in production mode.
- **dev** uses Node’s **--watch** flag for auto-restart during development.
- **express** — HTTP server.
- **yahoo-finance2** — Yahoo Finance data client.


## `vercel.json` (optional)


Explicit routing configuration for Vercel:


```json
{
  "version": 2,
  "routes": [
    {
      "src": "/api/(.*)",
      "dest": "/api/index.js"
    },
    {
      "src": "/(.*)",
      "dest": "/src/$1"
    }
  ]
}
```


- Routes all **/api/** requests to the serverless function at **api/index.js**.
- Serves everything else from **src/** as static files.


If your Vercel project already auto-detects the **api/** folder, this file can be omitted.


## How it all fits together


1. The user opens the page; **screener.js** reads saved thresholds from **localStorage**, renders threshold inputs, and calls **/api/ranges** with those thresholds.
2. The serverless function (**api/index.js**) parses thresholds from the query string, loads **symbols.json**, fetches a Yahoo Finance quote for each instrument, filters instruments by movement, and returns JSON.
3. The frontend renders each category as a card with a table, colors movements green/red/neutral, shows per-symbol errors, and saves threshold changes to **localStorage**.
4. On Vercel, each request to **/api/ranges** runs in an ephemeral function. No state is stored on the server; per-user configuration lives in the browser.


This design keeps the project simple, fully serverless, and easy to deploy while still giving each user a personalized view of market movements.
