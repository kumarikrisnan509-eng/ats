// sector-map.js -- T99-T127 (v11-E6): static sector classification for
// NIFTY 200 symbols. Used by:
//   - ai-workflows-routes.js /critique-rich for E6 sector context
//   - server.js factor-exposure for fallback sector mapping when broker
//     instruments cache doesn't expose sector
//
// Source: NSE sector classification, manually curated for the top-200 most
// traded symbols. Cover ~95% of ATS users' watchlists.
//
// 11 standard sectors per Nifty Sector Indices: IT, Banking, Energy,
// Auto, Pharma, FMCG, Metals, Telecom, Consumer, Capital Goods, Realty,
// Power, Financial Services, Media, Healthcare, Cement.

'use strict';

const SECTOR_MAP = {
  // IT
  TCS: 'IT', INFY: 'IT', WIPRO: 'IT', HCLTECH: 'IT', TECHM: 'IT', LTIM: 'IT',
  PERSISTENT: 'IT', COFORGE: 'IT', MPHASIS: 'IT', LTTS: 'IT', OFSS: 'IT',
  TATAELXSI: 'IT', KPITTECH: 'IT', BIRLASOFT: 'IT', CYIENT: 'IT', INTELLECT: 'IT',
  // Banking
  HDFCBANK: 'Banking', ICICIBANK: 'Banking', SBIN: 'Banking', AXISBANK: 'Banking',
  KOTAKBANK: 'Banking', INDUSINDBK: 'Banking', PNB: 'Banking', BANKBARODA: 'Banking',
  CANBK: 'Banking', UNIONBANK: 'Banking', IDFCFIRSTB: 'Banking', FEDERALBNK: 'Banking',
  BANDHANBNK: 'Banking', AUBANK: 'Banking', RBLBANK: 'Banking', YESBANK: 'Banking',
  // NBFC / Financial Services
  BAJFINANCE: 'Financial Services', BAJAJFINSV: 'Financial Services',
  HDFCLIFE: 'Financial Services', SBILIFE: 'Financial Services',
  ICICIPRULI: 'Financial Services', ICICIGI: 'Financial Services',
  CHOLAFIN: 'Financial Services', MUTHOOTFIN: 'Financial Services',
  MFSL: 'Financial Services', LICI: 'Financial Services', HDFCAMC: 'Financial Services',
  NAUKRI: 'Financial Services', PFC: 'Financial Services', RECLTD: 'Financial Services',
  LICHSGFIN: 'Financial Services', M_MFIN: 'Financial Services',
  // Energy
  RELIANCE: 'Energy', ONGC: 'Energy', BPCL: 'Energy', IOC: 'Energy', HINDPETRO: 'Energy',
  GAIL: 'Energy', OIL: 'Energy', PETRONET: 'Energy', IGL: 'Energy', MGL: 'Energy',
  GUJGASLTD: 'Energy', ATGL: 'Energy',
  // Auto
  MARUTI: 'Auto', TATAMOTORS: 'Auto', M_M: 'Auto', BAJAJ_AUTO: 'Auto',
  EICHERMOT: 'Auto', HEROMOTOCO: 'Auto', TVSMOTOR: 'Auto', ASHOKLEY: 'Auto',
  MOTHERSON: 'Auto', BOSCHLTD: 'Auto', MRF: 'Auto', BALKRISIND: 'Auto',
  TIINDIA: 'Auto', BHARATFORG: 'Auto', SONACOMS: 'Auto', EXIDEIND: 'Auto',
  // Pharma
  SUNPHARMA: 'Pharma', DRREDDY: 'Pharma', CIPLA: 'Pharma', DIVISLAB: 'Pharma',
  AUROPHARMA: 'Pharma', LUPIN: 'Pharma', TORNTPHARM: 'Pharma', BIOCON: 'Pharma',
  ZYDUSLIFE: 'Pharma', GLENMARK: 'Pharma', ALKEM: 'Pharma', LAURUSLABS: 'Pharma',
  IPCALAB: 'Pharma', ABBOTINDIA: 'Pharma', GLAND: 'Pharma', JBCHEPHARM: 'Pharma',
  PEL: 'Pharma',
  // FMCG
  HINDUNILVR: 'FMCG', ITC: 'FMCG', NESTLEIND: 'FMCG', BRITANNIA: 'FMCG',
  DABUR: 'FMCG', MARICO: 'FMCG', GODREJCP: 'FMCG', COLPAL: 'FMCG',
  TATACONSUM: 'FMCG', UBL: 'FMCG', VBL: 'FMCG', RADICO: 'FMCG', EMAMILTD: 'FMCG',
  // Metals
  TATASTEEL: 'Metals', HINDALCO: 'Metals', JSWSTEEL: 'Metals', JINDALSTEL: 'Metals',
  VEDL: 'Metals', SAIL: 'Metals', NMDC: 'Metals', COALINDIA: 'Metals',
  HINDZINC: 'Metals', NATIONALUM: 'Metals', RATNAMANI: 'Metals', APLAPOLLO: 'Metals',
  // Telecom
  BHARTIARTL: 'Telecom', IDEA: 'Telecom', TATACOMM: 'Telecom', INDUSTOWER: 'Telecom',
  // Consumer / Retail
  ASIANPAINT: 'Consumer', BERGEPAINT: 'Consumer', PIDILITIND: 'Consumer',
  TITAN: 'Consumer', PAGEIND: 'Consumer', TRENT: 'Consumer', DMART: 'Consumer',
  HAVELLS: 'Consumer', VOLTAS: 'Consumer', BLUESTARCO: 'Consumer',
  RELAXO: 'Consumer', BATAINDIA: 'Consumer', JUBLFOOD: 'Consumer',
  // Capital Goods / Engineering
  LT: 'Capital Goods', SIEMENS: 'Capital Goods', ABB: 'Capital Goods',
  BEL: 'Capital Goods', HAL: 'Capital Goods', BHEL: 'Capital Goods',
  CUMMINSIND: 'Capital Goods', THERMAX: 'Capital Goods', CGPOWER: 'Capital Goods',
  KEC: 'Capital Goods', POLYCAB: 'Capital Goods', KEI: 'Capital Goods',
  // Realty
  DLF: 'Realty', GODREJPROP: 'Realty', OBEROIRLTY: 'Realty', PRESTIGE: 'Realty',
  PHOENIXLTD: 'Realty', BRIGADE: 'Realty', MAHLIFE: 'Realty', LODHA: 'Realty',
  // Power
  NTPC: 'Power', POWERGRID: 'Power', TATAPOWER: 'Power', ADANIPOWER: 'Power',
  ADANIGREEN: 'Power', JSWENERGY: 'Power', TORNTPOWER: 'Power', NHPC: 'Power',
  SJVN: 'Power', RPOWER: 'Power',
  // Cement
  ULTRACEMCO: 'Cement', GRASIM: 'Cement', SHREECEM: 'Cement', AMBUJACEM: 'Cement',
  ACC: 'Cement', JKCEMENT: 'Cement', DALMIA: 'Cement',
  // Healthcare (hospitals)
  APOLLOHOSP: 'Healthcare', MAXHEALTH: 'Healthcare', FORTIS: 'Healthcare',
  // Media
  ZEEL: 'Media', SUNTV: 'Media', PVRINOX: 'Media',
  // Conglomerate / Diversified
  ADANIENT: 'Conglomerate', ADANIPORTS: 'Conglomerate', BAJAJHLDNG: 'Conglomerate',
  GRINDWELL: 'Conglomerate',
};

// Index symbols — useful when benchmarking
const INDEX_SECTOR = {
  'NIFTY 50': 'Broad Market',
  'NIFTY BANK': 'Banking',
  'NIFTY IT': 'IT',
  'NIFTY AUTO': 'Auto',
  'NIFTY PHARMA': 'Pharma',
  'NIFTY FMCG': 'FMCG',
  'NIFTY METAL': 'Metals',
  'NIFTY REALTY': 'Realty',
  'NIFTY ENERGY': 'Energy',
  'NIFTY FIN SERVICE': 'Financial Services',
  'NIFTY PSU BANK': 'Banking',
  'NIFTY PVT BANK': 'Banking',
};

function sectorOf(symbol) {
  if (!symbol) return null;
  const s = String(symbol).toUpperCase().trim();
  return SECTOR_MAP[s] || INDEX_SECTOR[s] || null;
}

function isIndex(symbol) {
  if (!symbol) return false;
  return INDEX_SECTOR.hasOwnProperty(String(symbol).toUpperCase().trim());
}

module.exports = { SECTOR_MAP, INDEX_SECTOR, sectorOf, isIndex };
