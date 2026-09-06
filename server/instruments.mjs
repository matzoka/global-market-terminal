const instrument = (id, name, region, kind, providerSymbol, decimals = 2, extra = {}) => ({
  id, name, region, kind, providerSymbol, decimals, ...extra,
});

export const instruments = [
  // "オルカン"そのものの基準価額ではありません。世界株を観察するための
  // 米国上場ACWI ETF参考値であることを UI でも常に明示します。
  instrument('ACWI', 'MSCI ACWI ETF（オルカン参考）', 'GLOBAL', 'etf', 'ACWI', 2, { alpacaSymbol: 'ACWI', researchGroup: 'global', referenceOnly: true }),
  instrument('SPX', 'S&P 500', 'US', 'index', 'SPX'),
  instrument('NDX', 'NASDAQ 100', 'US', 'index', 'NDX'),
  instrument('DJI', 'DOW JONES', 'US', 'index', 'DJI'),
  instrument('SX5E', 'EURO STOXX 50', 'EU', 'index', 'SX5E'),
  instrument('FTSE', 'FTSE 100', 'UK', 'index', 'FTSE'),
  instrument('DAX', 'DAX 40', 'DE', 'index', 'DAX'),
  instrument('N225', 'NIKKEI 225', 'JP', 'index', 'N225'),
  instrument('HSI', 'HANG SENG', 'HK', 'index', 'HSI'),
  instrument('SSE', 'SHANGHAI COMPOSITE', 'CN', 'index', 'SSE'),
  instrument('ASX', 'S&P/ASX 200', 'AU', 'index', 'ASX'),

  // FX は通貨ペアそのものの参考値。約定レート・スプレッド・スワップは
  // 利用する証券会社ごとに異なるため、ここでは表示しません。
  instrument('USDJPY', '米ドル／円', 'FX', 'fx', 'USD/JPY', 3, { researchGroup: 'fx' }),
  instrument('EURUSD', 'ユーロ／米ドル', 'FX', 'fx', 'EUR/USD', 5, { researchGroup: 'fx' }),
  instrument('GBPUSD', '英ポンド／米ドル', 'FX', 'fx', 'GBP/USD', 5, { researchGroup: 'fx' }),
  instrument('AUDUSD', '豪ドル／米ドル', 'FX', 'fx', 'AUD/USD', 5, { researchGroup: 'fx' }),
  instrument('EURJPY', 'ユーロ／円', 'FX', 'fx', 'EUR/JPY', 3, { researchGroup: 'fx' }),

  // CoinGecko の集計参考値。取引所の約定価格ではありません。
  instrument('BTCJPY', 'ビットコイン／円', 'CRYPTO', 'crypto', 'bitcoin', 0, { researchGroup: 'crypto', dataProvider: 'coingecko', coingeckoId: 'bitcoin', displaySymbol: 'BTC/JPY' }),
  instrument('ETHJPY', 'イーサリアム／円', 'CRYPTO', 'crypto', 'ethereum', 0, { researchGroup: 'crypto', dataProvider: 'coingecko', coingeckoId: 'ethereum', displaySymbol: 'ETH/JPY' }),
  instrument('SOLJPY', 'ソラナ／円', 'CRYPTO', 'crypto', 'solana', 0, { researchGroup: 'crypto', dataProvider: 'coingecko', coingeckoId: 'solana', displaySymbol: 'SOL/JPY' }),
  instrument('XRPJPY', 'エックスアールピー／円', 'CRYPTO', 'crypto', 'ripple', 2, { researchGroup: 'crypto', dataProvider: 'coingecko', coingeckoId: 'ripple', displaySymbol: 'XRP/JPY' }),

  instrument('NVDA', 'NVIDIA', 'US', 'equity', 'NVDA', 2, { alpacaSymbol: 'NVDA', sector: 'AI & SEMICONDUCTORS' }),
  instrument('MSFT', 'MICROSOFT', 'US', 'equity', 'MSFT', 2, { alpacaSymbol: 'MSFT', sector: 'AI & SEMICONDUCTORS' }),
  instrument('GOOGL', 'ALPHABET', 'US', 'equity', 'GOOGL', 2, { alpacaSymbol: 'GOOGL', sector: 'AI & SEMICONDUCTORS' }),
  instrument('AMD', 'AMD', 'US', 'equity', 'AMD', 2, { alpacaSymbol: 'AMD', sector: 'AI & SEMICONDUCTORS' }),
  instrument('TSM', 'TSMC ADR', 'US', 'equity', 'TSM', 2, { alpacaSymbol: 'TSM', sector: 'AI & SEMICONDUCTORS' }),
  instrument('PLTR', 'PALANTIR', 'US', 'equity', 'PLTR', 2, { alpacaSymbol: 'PLTR', sector: 'AI & SEMICONDUCTORS' }),
  instrument('XOM', 'EXXON MOBIL', 'US', 'equity', 'XOM', 2, { alpacaSymbol: 'XOM', sector: 'ENERGY' }),
  instrument('CVX', 'CHEVRON', 'US', 'equity', 'CVX', 2, { alpacaSymbol: 'CVX', sector: 'ENERGY' }),
  instrument('COP', 'CONOCOPHILLIPS', 'US', 'equity', 'COP', 2, { alpacaSymbol: 'COP', sector: 'ENERGY' }),
  instrument('SLB', 'SLB', 'US', 'equity', 'SLB', 2, { alpacaSymbol: 'SLB', sector: 'ENERGY' }),
  instrument('OXY', 'OCCIDENTAL', 'US', 'equity', 'OXY', 2, { alpacaSymbol: 'OXY', sector: 'ENERGY' }),
  instrument('BP', 'BP ADR', 'US', 'equity', 'BP', 2, { alpacaSymbol: 'BP', sector: 'ENERGY' }),
  instrument('JPM', 'JPMORGAN', 'US', 'equity', 'JPM', 2, { alpacaSymbol: 'JPM', sector: 'FINANCIALS' }),
  instrument('GS', 'GOLDMAN SACHS', 'US', 'equity', 'GS', 2, { alpacaSymbol: 'GS', sector: 'FINANCIALS' }),
  instrument('BAC', 'BANK OF AMERICA', 'US', 'equity', 'BAC', 2, { alpacaSymbol: 'BAC', sector: 'FINANCIALS' }),
  instrument('V', 'VISA', 'US', 'equity', 'V', 2, { alpacaSymbol: 'V', sector: 'FINANCIALS' }),
  instrument('MS', 'MORGAN STANLEY', 'US', 'equity', 'MS', 2, { alpacaSymbol: 'MS', sector: 'FINANCIALS' }),
  instrument('BRK_B', 'BERKSHIRE HATHAWAY B', 'US', 'equity', 'BRK.B', 2, { alpacaSymbol: 'BRK.B', sector: 'FINANCIALS', displaySymbol: 'BRK.B' }),
  instrument('AAPL', 'APPLE', 'US', 'equity', 'AAPL', 2, { alpacaSymbol: 'AAPL' }),

  // These are intentionally described as provider-configured instruments.
  // Their UI name is never allowed to imply spot data when a futures symbol is used.
  instrument('XAU', 'GOLD', 'GLOBAL', 'metal', 'XAU/USD', 2, { displaySymbol: 'XAU/USD', contractLabel: 'SPOT — PROVIDER CONFIGURATION REQUIRED' }),
  instrument('XAG', 'SILVER', 'GLOBAL', 'metal', 'XAG/USD', 3, { displaySymbol: 'XAG/USD', contractLabel: 'SPOT — PROVIDER CONFIGURATION REQUIRED' }),
  instrument('XPT', 'PLATINUM', 'GLOBAL', 'metal', 'XPT/USD', 2, { displaySymbol: 'XPT/USD', contractLabel: 'SPOT — PROVIDER CONFIGURATION REQUIRED' }),
  instrument('XPD', 'PALLADIUM', 'GLOBAL', 'metal', 'XPD/USD', 2, { displaySymbol: 'XPD/USD', contractLabel: 'SPOT — PROVIDER CONFIGURATION REQUIRED' }),
];

export const byId = new Map(instruments.map((item) => [item.id, item]));
export const indexIds = instruments.filter((item) => item.kind === 'index').map((item) => item.id);
export const sectorIds = instruments.filter((item) => item.sector).map((item) => item.id);
export const metalIds = instruments.filter((item) => item.kind === 'metal').map((item) => item.id);
export const researchIds = Object.freeze({
  global: ['ACWI', 'SPX', 'NDX', 'N225', 'DAX', 'HSI'],
  fx: ['USDJPY', 'EURUSD', 'GBPUSD', 'AUDUSD', 'EURJPY'],
  crypto: ['BTCJPY', 'ETHJPY', 'SOLJPY', 'XRPJPY'],
});
