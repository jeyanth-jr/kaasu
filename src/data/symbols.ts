/**
 * Offline fallback for symbol type-ahead: widely held NSE stocks and ETFs.
 * When the price proxy is running, live search covers everything else.
 */
export interface KnownSymbol {
  symbol: string;
  name: string;
  sector: string;
  type: "stock" | "etf";
  trackingIndex?: string;
  gold?: boolean;
}

const S = (symbol: string, name: string, sector: string): KnownSymbol => ({ symbol, name, sector, type: "stock" });
const E = (symbol: string, name: string, trackingIndex: string, gold = false): KnownSymbol => ({ symbol, name, sector: gold ? "Gold" : "Index", type: "etf", trackingIndex, gold });

export const KNOWN_SYMBOLS: KnownSymbol[] = [
  S("RELIANCE", "Reliance Industries", "Energy"),
  S("HDFCBANK", "HDFC Bank", "Financials"),
  S("ICICIBANK", "ICICI Bank", "Financials"),
  S("SBIN", "State Bank of India", "Financials"),
  S("KOTAKBANK", "Kotak Mahindra Bank", "Financials"),
  S("AXISBANK", "Axis Bank", "Financials"),
  S("INDUSINDBK", "IndusInd Bank", "Financials"),
  S("IDFCFIRSTB", "IDFC First Bank", "Financials"),
  S("CANBK", "Canara Bank", "Financials"),
  S("PNB", "Punjab National Bank", "Financials"),
  S("BANKBARODA", "Bank of Baroda", "Financials"),
  S("FEDERALBNK", "Federal Bank", "Financials"),
  S("KTKBANK", "Karnataka Bank", "Financials"),
  S("SOUTHBANK", "South Indian Bank", "Financials"),
  S("BAJFINANCE", "Bajaj Finance", "Financials"),
  S("BAJAJFINSV", "Bajaj Finserv", "Financials"),
  S("MANAPPURAM", "Manappuram Finance", "Financials"),
  S("MUTHOOTFIN", "Muthoot Finance", "Financials"),
  S("PNBHOUSING", "PNB Housing Finance", "Financials"),
  S("RECLTD", "REC Ltd", "Financials"),
  S("PFC", "Power Finance Corporation", "Financials"),
  S("LICI", "Life Insurance Corporation", "Financials"),
  S("HDFCLIFE", "HDFC Life Insurance", "Financials"),
  S("SBILIFE", "SBI Life Insurance", "Financials"),
  S("TCS", "Tata Consultancy Services", "IT"),
  S("INFY", "Infosys", "IT"),
  S("HCLTECH", "HCL Technologies", "IT"),
  S("WIPRO", "Wipro", "IT"),
  S("TECHM", "Tech Mahindra", "IT"),
  S("LTIM", "LTIMindtree", "IT"),
  S("ITC", "ITC", "FMCG"),
  S("HINDUNILVR", "Hindustan Unilever", "FMCG"),
  S("NESTLEIND", "Nestle India", "FMCG"),
  S("BRITANNIA", "Britannia Industries", "FMCG"),
  S("TATACONSUM", "Tata Consumer Products", "FMCG"),
  S("ASIANPAINT", "Asian Paints", "Consumer"),
  S("TITAN", "Titan Company", "Consumer"),
  S("DMART", "Avenue Supermarts", "Consumer"),
  S("TRENT", "Trent", "Consumer"),
  S("IRCTC", "Indian Railway Catering & Tourism", "Consumer Services"),
  S("ZOMATO", "Eternal (Zomato)", "Consumer Services"),
  S("MARUTI", "Maruti Suzuki", "Automobile"),
  S("TMPV", "Tata Motors Passenger Vehicles", "Automobile"),
  S("TMCV", "Tata Motors (commercial vehicles)", "Automobile"),
  S("M&M", "Mahindra & Mahindra", "Automobile"),
  S("BAJAJ-AUTO", "Bajaj Auto", "Automobile"),
  S("EICHERMOT", "Eicher Motors", "Automobile"),
  S("HEROMOTOCO", "Hero MotoCorp", "Automobile"),
  S("SUNPHARMA", "Sun Pharmaceutical", "Healthcare"),
  S("DRREDDY", "Dr. Reddy's Laboratories", "Healthcare"),
  S("CIPLA", "Cipla", "Healthcare"),
  S("NATCOPHARM", "Natco Pharma", "Healthcare"),
  S("DIVISLAB", "Divi's Laboratories", "Healthcare"),
  S("APOLLOHOSP", "Apollo Hospitals", "Healthcare"),
  S("LT", "Larsen & Toubro", "Industrials"),
  S("TRITURBINE", "Triveni Turbine", "Industrials"),
  S("BEL", "Bharat Electronics", "Industrials"),
  S("HAL", "Hindustan Aeronautics", "Industrials"),
  S("SIEMENS", "Siemens", "Industrials"),
  S("ULTRACEMCO", "UltraTech Cement", "Materials"),
  S("TATASTEEL", "Tata Steel", "Materials"),
  S("JSWSTEEL", "JSW Steel", "Materials"),
  S("HINDALCO", "Hindalco Industries", "Materials"),
  S("COALINDIA", "Coal India", "Energy"),
  S("ONGC", "Oil & Natural Gas Corporation", "Energy"),
  S("NTPC", "NTPC", "Utilities"),
  S("POWERGRID", "Power Grid Corporation", "Utilities"),
  S("TATAPOWER", "Tata Power", "Utilities"),
  S("ADANIENT", "Adani Enterprises", "Industrials"),
  S("ADANIPORTS", "Adani Ports & SEZ", "Industrials"),
  S("BHARTIARTL", "Bharti Airtel", "Telecom"),
  E("NIFTYBEES", "Nippon India ETF Nifty BeES", "NIFTY 50"),
  E("JUNIORBEES", "Nippon India ETF Nifty Next 50 Junior BeES", "NIFTY NEXT 50"),
  E("BANKBEES", "Nippon India ETF Bank BeES", "NIFTY BANK"),
  E("SETFNIF50", "SBI Nifty 50 ETF", "NIFTY 50"),
  E("UTINIFTETF", "UTI Nifty 50 ETF", "NIFTY 50"),
  E("ICICINIFTY", "ICICI Prudential Nifty 50 ETF", "NIFTY 50"),
  E("MON100", "Motilal Oswal Nasdaq 100 ETF", "NASDAQ 100"),
  E("MAFANG", "Mirae Asset NYSE FANG+ ETF", "NYSE FANG+"),
  E("MIDCAPETF", "Mirae Asset Nifty Midcap 150 ETF", "NIFTY MIDCAP 150"),
  E("LIQUIDBEES", "Nippon India ETF Liquid BeES", "LIQUID"),
  E("GOLDBEES", "Nippon India ETF Gold BeES", "GOLD", true),
  E("SETFGOLD", "SBI Gold ETF", "GOLD", true),
  E("HDFCGOLD", "HDFC Gold ETF", "GOLD", true),
  E("SILVERBEES", "Nippon India Silver ETF", "SILVER"),
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Offline search; ignores punctuation and spacing so "Dr Reddys" finds "Dr. Reddy's Laboratories". */
export function searchKnownSymbols(q: string, limit = 8): KnownSymbol[] {
  const s = norm(q);
  if (!s) return [];
  return KNOWN_SYMBOLS.map((k) => {
    const sym = norm(k.symbol);
    const name = norm(k.name);
    const score = sym === s ? 100 : sym.startsWith(s) ? 50 : name.startsWith(s) ? 40 : name.includes(s) ? 20 : sym.includes(s) ? 10 : s.startsWith(name) ? 15 : 0;
    return { k, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.k);
}
