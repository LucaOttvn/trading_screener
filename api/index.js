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
    logErrors: true,
    logOptionsErrors: true,
  },
});

const PORT = process.env.PORT || 3000;
const SYMBOLS_FILE = join(__dirname, "../src/symbols.json");
const STATIC_DIR = join(__dirname, "../src");
const USE_BODY = false;

const CATEGORIES = {
  forex: {
    label: "Forex",
    threshold: 0.05,
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

const round = (number, decimals = 3) =>
  Number(number.toFixed(decimals));

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
  // get historycal data
  const { quotes = [] } = await yf.chart(symbol, {
    period1: new Date(Date.now() - 3 * 864e5),
    interval: "1d",
  });

  // get the last day
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
    label: label || symbol,
    range_in_percentage: round(rangeInPercentage),
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

/**
 * when the script is run locally, the path refers to the file itself.  
 * When it's run on Vercel's Node runtime instead, it refers to Vercel's own generated handler (a launcher/bootstrap file), not this api/index.js file.  
 * For this reason we check the path of the currently executed file to verify if it's a local run or a Vercel one.   
 * In case it's local, the file is run as a server, while when it's on Vercel, it only behaves as a module.
 * 
 * process.argv[1] obtains the file path that the run command put as an argument (node <filename>, filename is the index 1 of the arguments array in the command)
 */
const filePath = process.argv[1]

const isMain =
  Boolean(filePath) &&
  fileURLToPath(import.meta.url) === resolve(filePath);

if (isMain) {
  app.listen(PORT, () => {
    console.log(`[screener] → http://localhost:${PORT}`);
  });
}

export default app;