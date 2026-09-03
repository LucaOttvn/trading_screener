import YahooFinance from "yahoo-finance2/src/index.ts";
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const yf = new YahooFinance();

const SYMBOLS_FILE = join(__dirname, "symbols.txt");
const OUTPUT_PREFIX = join(__dirname, "outputs/");
console.log(OUTPUT_PREFIX)
const USE_BODY = false;

const CATEGORIES = {
  stocks: { label: "Stocks", threshold: 2 },
  forex: { label: "Forex", threshold: 0.05 },
  indices: { label: "Indices", threshold: 3 },
  "raw-materials": { label: "Raw materials", threshold: 0.1 },
  crypto: { label: "Crypto", threshold: 0.5 },
};

const round = (n, decimals = 3) => +n.toFixed(decimals);

function readSymbols() {
  const groups = {};
  let category;

  for (const rawLine of readFileSync(SYMBOLS_FILE, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = line.match(/^#\s*\[([\w-]+)\]\s*$/);

    if (match) {
      category = CATEGORIES[match[1]] ? match[1] : null;
      if (category) groups[category] ??= [];
    } else if (line && !line.startsWith("#") && category) {
      groups[category].push(line);
    }
  }

  return groups;
}

async function main() {
  const symbolsByCategory = readSymbols();
  const results = Object.fromEntries(Object.keys(CATEGORIES).map((key) => [key, []]));

  for (const [category, symbols] of Object.entries(symbolsByCategory)) {
    for (const [index, symbol] of symbols.entries()) {
      process.stdout.write(
        `\rLoading ${CATEGORIES[category].label}: ${index + 1}/${symbols.length} - ${symbol}...`
      );
      try {
        const { quotes = [] } = await yf.chart(symbol, {
          period1: new Date(Date.now() - 65 * 864e5),
          interval: "1d",
        });

        const last = quotes.at(-1);
        if (!last?.close || last.open == null || last.high == null || last.low == null) continue;

        const movement = USE_BODY
          ? Math.abs(last.close - last.open)
          : last.high - last.low;

        const range_in_percentage = (movement / last.close) * 100;

        if (range_in_percentage < CATEGORIES[category].threshold) {
          results[category].push({
            symbol,
            date: last.date.toISOString().slice(0, 10),
            range_in_percentage: round(range_in_percentage),
            open: round(last.open, 6),
            high: round(last.high, 6),
            low: round(last.low, 6),
            close: round(last.close, 6),
          });
        }
      } catch (error) {
        console.error(`[ERR] ${symbol}: ${error.message}`);
      }
    }
  }

  for (const [category, config] of Object.entries(CATEGORIES)) {
    const rows = results[category];
    const headers = ["symbol", "date", "range_in_percentage", "open", "high", "low", "close"];

    writeFileSync(
      `${OUTPUT_PREFIX}${category}.csv`,
      [headers.join(","), ...rows.map((row) => headers.map((h) => row[h]).join(","))].join("\n")
    );

    console.log(`\n${config.label}: ${rows.length} symbols with range < ${config.threshold}%`);

    rows.length
      ? console.table(rows.map(({ symbol, date, range_in_percentage }) => ({ symbol, date, range_in_percentage })))
      : console.log("No symbols below threshold.");
  }
}

main().catch(console.error);