require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

module.exports = {
  FINNHUB_KEY: process.env.FINNHUB_KEY,
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  MARKETAUX_KEY: process.env.MARKETAUX_KEY,
  REFRESH_INTERVAL: 5,
  DEFAULT_STOCKS: ['AAPL', 'TSLA', 'GOOGL', 'MSFT', 'AMZN', 'TCS', 'META', 'RELIANCE', 'LLY'],
  PORT: process.env.PORT || 3001
};