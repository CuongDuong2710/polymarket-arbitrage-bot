import express from 'express';
import config from './config/config';
import logger from './utils/logger';
import MarketMonitor from './services/MarketMonitor';
import ArbitrageDetector from './services/ArbitrageDetector';
import TradeExecutor from './services/TradeExecutor';
import RiskManager from './services/RiskManager';

const app = express();

// Middleware
app.use(express.json());

// Initialize services
const marketMonitor = new MarketMonitor();
const arbitrageDetector = new ArbitrageDetector();
const tradeExecutor = new TradeExecutor();
const riskManager = new RiskManager();

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.get('/api/markets', (req, res) => {
  const markets = marketMonitor.getMarkets();
  res.json({ markets, count: markets.length });
});

app.get('/api/positions', (req, res) => {
  const positions = riskManager.getPositions();
  res.json({ positions, totalExposure: riskManager. getTotalExposure() });
});

app.get('/api/trades/pending', (req, res) => {
  const trades = tradeExecutor.getPendingTrades();
  res.json({ trades, count: trades. length });
});

// Start server
const startServer = async () => {
  try {
    // Validate configuration
    if (!config.wallet.privateKey && config.trading.enabled) {
      logger.error('Private key not configured. Set TRADING_ENABLED=false or add PRIVATE_KEY');
      process.exit(1);
    }

    // Start market monitoring
    await marketMonitor.start();

    // Start Express server
    app.listen(config.server.port, () => {
      logger.info(`🚀 Polymarket Arbitrage Bot running on port ${config.server. port}`);
      logger.info(`📊 Trading enabled: ${config.trading.enabled}`);
      logger.info(`💰 Min profit threshold: ${config.trading.minProfitThreshold * 100}%`);
      logger.info(`📈 Max position size: ${config.trading.maxPositionSize}`);
    });
  } catch (error) {
    logger.error('Failed to start server', error);
    process.exit(1);
  }
};

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down gracefully...');
  await marketMonitor.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Shutting down gracefully.. .');
  await marketMonitor. stop();
  process.exit(0);
});

// Start the application
startServer();