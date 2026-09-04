import express from "express";
import YahooFinance from "yahoo-finance2";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

const yf = new YahooFinance({
  validation: {
    logErrors: false,
    logOptionsErrors: false,
  },
});

const PORT = process.env.PORT || 3000;
const SYMBOLS_FILE = join(__dirname, "../src/symbols.json");
const STATIC_DIR = join(__dirname, "../src");

const CATEGORIES = {
  forex: {
    label: "Forex",
    threshold: 0.05,
  },
  stocks: {
    label: "Stocks",
    threshold: 2,
  },
  indices: {
    label: "Indices",
    threshold: 0.1,
  },
  "raw-materials": {
    label: "Raw materials",
    threshold: 0.1,
  },
  crypto: {
    label: "Crypto",
    threshold: 0.5,
  },
};

const round = (number, decimals = 3) => {
  if (number == null || !Number.isFinite(number)) {
    return null;
  }

  return Number(number.toFixed(decimals));
};

function formatPercentage(value) {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }

  const sign = value > 0 ? "+" : "";

  return `${sign}${value.toFixed(2)}%`;
}

function readSymbols() {
  const fileContent = readFileSync(SYMBOLS_FILE, "utf8");
  const parsedSymbols = JSON.parse(fileContent);

  return Object.fromEntries(
    Object.keys(CATEGORIES).map((category) => [
      category,
      Array.isArray(parsedSymbols[category])
        ? parsedSymbols[category]
        : [],
    ])
  );
}

async function fetchSymbolData(category, symbol, label) {
  const quote = await yf.quote(symbol);

  const changePercent = quote.regularMarketChangePercent;
  const price = quote.regularMarketPrice;
  const previousClose = quote.regularMarketPreviousClose;

  if (
    changePercent == null ||
    !Number.isFinite(changePercent) ||
    price == null ||
    !Number.isFinite(price)
  ) {
    return null;
  }

  const absoluteChangePercent = Math.abs(changePercent);
  const threshold = CATEGORIES[category].threshold;

  // Keeps only instruments whose movement is BELOW the category threshold.
  // Change >= to <= if you instead want to show large movements only.
  if (absoluteChangePercent >= threshold) {
    return null;
  }

  return {
    symbol,
    label: label || symbol,

    price: round(price),
    previous_close: round(previousClose),
    change: round(quote.regularMarketChange),

    // Numeric value, useful for sorting/filtering/charting.
    change_percentage: round(changePercent, 3),

    // Directly usable in the UI: "+0.12%" / "-0.03%".
    formatted_change_percentage: formatPercentage(changePercent),

    currency: quote.currency || null,
    market_state: quote.marketState || null,
  };
}

async function generateMarketData() {
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
          label
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
          threshold: config.threshold,
          symbols: results[category],
          count: results[category].length,
        },
      ])
    ),
    errors,
  };
}

app.get("/api/ranges", async (_request, response) => {
  try {
    const data = await generateMarketData();

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

app.use(express.static(STATIC_DIR));

const filePath = process.argv[1];

const isMain =
  Boolean(filePath) &&
  fileURLToPath(import.meta.url) === resolve(filePath);

if (isMain) {
  app.listen(PORT, () => {
    console.log(`[screener] → http://localhost:${PORT}`);
  });
}

export default app;