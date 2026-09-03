import YahooFinance from "yahoo-finance2/src/index.ts";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const yf = new YahooFinance();

const SYMBOLS_FILE = join(__dirname, "symbols.json");
const OUTPUT_DIR = join(__dirname, "outputs");
const OUTPUT_FILE = join(OUTPUT_DIR, "market-ranges.json");

const USE_BODY = false;

const CATEGORIES = {
  stocks: {
    label: "Stocks",
    threshold: 2,
  },
  forex: {
    label: "Forex",
    threshold: 0.05,
  },
  indices: {
    label: "Indices",
    threshold: 3,
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

const round = (number, decimals = 3) =>
  Number(number.toFixed(decimals));

function readSymbols() {
  const fileContent = readFileSync(SYMBOLS_FILE, "utf8");
  const symbolsByCategory = JSON.parse(fileContent);

  return Object.fromEntries(
    Object.keys(CATEGORIES).map((category) => {
      const symbols = symbolsByCategory[category];

      return [
        category,
        Array.isArray(symbols) ? symbols : [],
      ];
    })
  );
}

function createEmptyResults() {
  return Object.fromEntries(
    Object.keys(CATEGORIES).map((category) => [
      category,
      [],
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
    !last.close ||
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

  if (
    rangeInPercentage >= CATEGORIES[category].threshold
  ) {
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

async function main() {
  const symbolsByCategory = readSymbols();
  const results = createEmptyResults();
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

  const output = {
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

  mkdirSync(OUTPUT_DIR, {
    recursive: true,
  });

  writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(output, null, 2),
    "utf8"
  );

  console.log(`JSON written to ${OUTPUT_FILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});