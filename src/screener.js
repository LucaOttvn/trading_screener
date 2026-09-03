const DATA_URL = "/api/ranges";

const updatedElement = document.querySelector("#updated");
const statusElement = document.querySelector("#status");
const categoriesElement = document.querySelector("#categories");
const errorsElement = document.querySelector("#errors");

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatPercentage(value) {
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function renderSymbol(symbol) {
  return `
    <article class="symbol-row">
      <span class="symbol-name">
        ${escapeHtml(symbol.symbol)}
      </span>

      <span class="symbol-range">
        ${formatPercentage(symbol.range_in_percentage)}%
      </span>
    </article>
  `;
}

function renderCategory(categoryKey, category) {
  const symbols = Array.isArray(category.symbols)
    ? category.symbols
    : [];

  const label = category.label || categoryKey;
  const threshold = category.threshold;

  return `
    <section class="category">
      <header class="category-header">
        <div>
          <h2>${escapeHtml(label)}</h2>
          <span class="category-threshold">
            Range below ${formatPercentage(threshold)}%
          </span>
        </div>

        <span class="category-count">
          ${symbols.length}
        </span>
      </header>

      ${
        symbols.length
          ? `
            <div class="symbol-list">
              ${symbols.map(renderSymbol).join("")}
            </div>
          `
          : `
            <p class="empty">
              No symbols found.
            </p>
          `
      }
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
                ${escapeHtml(error.symbol)}:
                ${escapeHtml(error.message)}
              </li>
            `
          )
          .join("")}
      </ul>
    </section>
  `;
}

async function loadData() {
  try {
    const response = await fetch(DATA_URL, {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    updatedElement.textContent = data.generated_at
      ? `Generated: ${new Date(data.generated_at).toLocaleString()}`
      : "Market data";

    categoriesElement.innerHTML = Object.entries(data.categories)
      .map(([categoryKey, category]) =>
        renderCategory(categoryKey, category)
      )
      .join("");

    renderErrors(data.errors);

    statusElement.remove();
  } catch (error) {
    statusElement.textContent =
      `Could not load market data: ${error.message}`;

    statusElement.style.color = "#9f1239";
    statusElement.style.background = "#fff1f2";
  }
}

loadData();