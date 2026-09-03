import express from "express";
import YahooFinance from "yahoo-finance2";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const yf = new YahooFinance();

const SYMBOLS_FILE = join(__dirname, "../src/symbols.json");
const USE_BODY = false;

const CATEGORIES = {
  stocks: { label: "Stocks", threshold: 2 },
  forex: { label: "Forex", threshold: 0.05 },
  indices: { label: "Indices", threshold: 3 },
  "raw-materials": { label: "Raw materials", threshold: 0.1 },
  crypto: { label: "Crypto", threshold: 0.5 },
};

const round = (number, decimals = 3) =>
  Number(number.toFixed(decimals));

function readSymbols() {
  const rawData = readFileSync(SYMBOLS_FILE, "utf8");
  const parsedData = JSON.parse(rawData);

  return Object.fromEntries(
    Object.keys(CATEGORIES).map((category) => [
      category,
      Array.isArray(parsedData[category])
        ? parsedData[category]
        : [],
    ])
  );
}

async function fetchSymbolData(category, symbol) {
  const { quotes = [] } = await yf.chart(symbol, {
    period1: new Date(Date.now() - 65 * 864e5),
    interval: "1d",
  });

  const last = quotes.at(-1);

  if (
    !last ||
    last.close == null ||
    last.open == null ||
    last.high == null ||
    last.low == null
  ) {
    return null;
  }

  const movement = USE_BODY
    ? Math.abs(last.close - last.open)
    : last.high - last.low;

  const rangeInPercentage = (movement / last.close) * 100;

  if (rangeInPercentage >= CATEGORIES[category].threshold) {
    return null;
  }

  return {
    symbol,
    date: last.date.toISOString().slice(0, 10),
    range_in_percentage: round(rangeInPercentage),
    open: round(last.open, 6),
    high: round(last.high, 6),
    low: round(last.low, 6),
    close: round(last.close, 6),
  };
}

async function generateMarketData() {
  const symbolsByCategory = readSymbols();

  const results = Object.fromEntries(
    Object.keys(CATEGORIES).map((category) => [category, []])
  );

  const errors = [];

  for (const [category, symbols] of Object.entries(symbolsByCategory)) {
    for (const symbol of symbols) {
      try {
        const data = await fetchSymbolData(category, symbol);

        if (data) {
          results[category].push(data);
        }
      } catch (error) {
        errors.push({
          category,
          symbol,
          message: error instanceof Error
            ? error.message
            : String(error),
        });
      }
    }
  }

  return {
    generated_at: new Date().toISOString(),
    use_body: USE_BODY,
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

    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.json(data);
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error
        ? error.message
        : String(error),
    });
  }
});

export default app;