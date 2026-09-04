const categoriesElement = document.querySelector("#categories");
const errorsElement = document.querySelector("#errors");
const statusElement = document.querySelector("#status");
const updatedElement = document.querySelector("#updated");
const refreshButton = document.querySelector("#refresh-button");

const thresholdForm = document.querySelector("#threshold-form");
const thresholdInputsElement = document.querySelector("#threshold-inputs");
const resetButton = document.querySelector("#reset-button");

const STORAGE_KEY = "market-screener-thresholds";

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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

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

function movementClass(changePercentage) {
  if (changePercentage > 0) {
    return "is-positive";
  }

  if (changePercentage < 0) {
    return "is-negative";
  }

  return "is-neutral";
}

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

function setLoadingState(isLoading) {
  refreshButton.disabled = isLoading;
  resetButton.disabled = isLoading;

  refreshButton.textContent = isLoading
    ? "Refreshing..."
    : "Refresh";
}

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
    const message =
      error instanceof Error
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

thresholdForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const thresholds = getThresholdsFromForm();

  saveThresholds(thresholds);
  loadMarketData(thresholds);
});

refreshButton.addEventListener("click", () => {
  const thresholds = getThresholdsFromForm();

  saveThresholds(thresholds);
  loadMarketData(thresholds);
});

resetButton.addEventListener("click", () => {
  const thresholds = { ...DEFAULT_THRESHOLDS };

  saveThresholds(thresholds);
  renderThresholdInputs(thresholds);
  loadMarketData(thresholds);
});

const initialThresholds = getSavedThresholds();

renderThresholdInputs(initialThresholds);
loadMarketData(initialThresholds);