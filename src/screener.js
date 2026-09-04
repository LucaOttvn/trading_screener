const categoriesElement = document.querySelector("#categories");
const errorsElement = document.querySelector("#errors");
const statusElement = document.querySelector("#status");
const updatedElement = document.querySelector("#updated");
const refreshButton = document.querySelector("#refresh-button");

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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
          No instruments currently match this category’s threshold.
        </p>
      `
      : `
        <table class="market-table">

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
            Showing movements below ${escapeHtml(threshold)}%
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

  refreshButton.textContent = isLoading
    ? "Refreshing..."
    : "Refresh";
}

async function loadMarketData() {
  setLoadingState(true);

  statusElement.classList.remove("is-error");
  statusElement.textContent = "Loading market data...";

  try {
    const response = await fetch("/api/ranges", {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(
        `The server returned HTTP ${response.status}.`
      );
    }

    const data = await response.json();

    const categories = Object.values(data.categories || {});

    categoriesElement.innerHTML = categories
      .map(renderCategory)
      .join("");

    updatedElement.textContent = formatDate(data.generated_at);

    statusElement.textContent =
      "Daily movement compared with the previous regular-market close.";

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

refreshButton.addEventListener("click", loadMarketData);

loadMarketData();