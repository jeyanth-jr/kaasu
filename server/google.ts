/**
 * Google Finance has no public API (GOOGLEFINANCE() only exists inside
 * Sheets), so we read the quote page's embedded data. Each security on the
 * page appears as a tuple like:
 *   ["/g/…",["INFY","NSE"],"Infosys Ltd",0,"INR",[1143.9,-17.3,-1.49,2,2,2],null,1161.2,"#3c84c3","IN","/m/…",[1792386785], …
 * i.e. [id, [symbol, exchange], name, type, currency, [price, change, pct, …], null, previousClose, colour, country, entity, [epochSeconds]].
 * Pages also carry tuples for *related* securities, so we only accept the
 * tuple whose [symbol, exchange] exactly matches the request.
 */

export interface GoogleQuote {
  price: number;
  prevClose: number | null;
  /** ISO timestamp of the last trade Google reports. */
  time: string;
  name: string;
  currency: string;
}

/** Kaasu exchange → Google Finance exchange code. BSE scrips use numeric codes, e.g. 500325:BOM. */
export function googleExchange(exchange: string): string {
  return exchange.toUpperCase() === "BSE" ? "BOM" : "NSE";
}

export function googleQuoteUrl(exchange: string, symbol: string): string {
  return `https://www.google.com/finance/quote/${encodeURIComponent(symbol.toUpperCase())}:${googleExchange(exchange)}?hl=en`;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const NUM = "(-?\\d+(?:\\.\\d+)?(?:[eE][-+]?\\d+)?)";

export function parseGoogleQuote(html: string, symbol: string, exchange: string): GoogleQuote | null {
  const ex = googleExchange(exchange);
  const sym = symbol.toUpperCase();
  // "&" may be JSON-escaped inside the page's script data (M&M → M&M).
  const variants = [...new Set([sym, sym.replace(/&/g, "\\u0026")])];
  for (const v of variants) {
    const re = new RegExp(
      `\\["/[gm]/[^"]+",\\["${escapeRe(v)}","${ex}"\\],"((?:[^"\\\\]|\\\\.)*)",\\d+,"([A-Z]{3})",\\[${NUM},[^\\]]*\\],(?:null|${NUM}),${NUM},"[^"]*","[A-Z]*","[^"]*",\\[(\\d+)\\]`,
    );
    const m = re.exec(html);
    if (!m) continue;
    const price = Number(m[3]);
    const prev = Number(m[5]);
    const epoch = Number(m[6]);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(epoch)) return null;
    return {
      price,
      prevClose: Number.isFinite(prev) && prev > 0 ? prev : null,
      time: new Date(epoch * 1000).toISOString(),
      name: JSON.parse(`"${m[1]}"`) as string,
      currency: m[2]!,
    };
  }
  return null;
}
