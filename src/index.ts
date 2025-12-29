import express from 'express';
import config from './config/config';
import logger from './utils/logger';
import MarketMonitor from './services/MarketMonitor';
import ArbitrageDetector from './services/ArbitrageDetector';
import TradeExecutor from './services/TradeExecutor';
import RiskManager from './services/RiskManager';
import PolymarketClient from './api/PolymarketClient';
import { MonitoringEventType } from './models/Events';

const app = express();

// Middleware
app.use(express.json());

// Initialize services
const polymarketClient = new PolymarketClient();
const marketMonitor = new MarketMonitor();
const arbitrageDetector = new ArbitrageDetector();
const tradeExecutor = new TradeExecutor();
const riskManager = new RiskManager();

// Set up event listeners
marketMonitor.on(MonitoringEventType.MARKET_ADDED, (event) => {
  logger.info(`📈 New market:  ${event.market.question}`);
});

marketMonitor.on(MonitoringEventType.MARKET_REMOVED, (event) => {
  logger.info(`📉 Market removed: ${event.market.question}`);
});

marketMonitor.on(MonitoringEventType.PRICE_SPIKE, (event) => {
  logger.warn(
    `🚨 Price spike:  ${event.outcome} in market ${event.marketId} - ${(event.changePercentage * 100).toFixed(2)}% change`
  );
});

marketMonitor.on(MonitoringEventType.PRICE_UPDATED, (event) => {
  // Run arbitrage detection on price updates
  const opportunities = arbitrageDetector.detectOpportunities(event.prices);

  if (opportunities.length > 0) {
    logger.info(
      `💰 Found ${opportunities.length} arbitrage opportunities in market ${event.marketId}`
    );
  }
});

marketMonitor.on(MonitoringEventType.MONITORING_ERROR, (event) => {
  logger.error(`❌ Monitoring error: ${event.error.message}`);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    trading: config.trading.enabled,
    mockMode: config.polymarket.useMock,
    monitoring: marketMonitor.isMonitoring(),
  });
});

// Statistics endpoint
app.get('/api/stats', (req, res) => {
  const stats = marketMonitor.getStatistics();
  res.json(stats);
});

// Markets endpoints
app.get('/api/markets', (req, res) => {
  const markets = marketMonitor.getMarkets();
  res.json({ markets, count: markets.length });
});

app.get('/api/markets/: marketId', (req, res) => {
  const { marketId } = req.params;
  const market = marketMonitor.getMarket(marketId);

  if (!market) {
    return res.status(404).json({ error: 'Market not found' });
  }

  const prices = marketMonitor.getPrices(marketId);
  const state = marketMonitor.getMarketState(marketId);

  res.json({ market, prices, state });
});

app.get('/api/markets/:marketId/prices', (req, res) => {
  const { marketId } = req.params;
  const prices = marketMonitor.getPrices(marketId);

  if (prices.length === 0) {
    return res.status(404).json({ error: 'No prices found for market' });
  }

  res.json({ marketId, prices, count: prices.length });
});

app.get('/api/markets/:marketId/state', (req, res) => {
  const { marketId } = req.params;
  const state = marketMonitor.getMarketState(marketId);

  if (!state) {
    return res.status(404).json({ error: 'Market state not found' });
  }

  res.json(state);
});

app.get('/api/trending', async (req, res) => {
  try {
    const trending = await marketMonitor.getTrendingMarkets();
    res.json({ markets: trending, count: trending.length });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch trending markets' });
  }
});

app.get('/api/volatile', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 10;
  const volatile = marketMonitor.getTopVolatileMarkets(limit);
  res.json({ markets: volatile, count: volatile.length });
});

// Position and trade endpoints
app.get('/api/positions', (req, res) => {
  const positions = riskManager.getPositions();
  res.json({ positions, totalExposure: riskManager.getTotalExposure() });
});

app.get('/api/trades/pending', (req, res) => {
  const trades = tradeExecutor.getPendingTrades();
  res.json({ trades, count: trades.length });
});

// Start server
const startServer = async () => {
  try {
    logger.info('🚀 Starting Polymarket Arbitrage Bot.. .');

    // Validate configuration
    if (!config.wallet.privateKey && config.trading.enabled) {
      logger.error('Private key not configured. Set TRADING_ENABLED=false or add PRIVATE_KEY');
      process.exit(1);
    }

    // Initialize Polymarket client (only if not using mock)
    if (!config.polymarket.useMock) {
      await polymarketClient.initialize();
    } else {
      logger.warn('⚠️  Running in MOCK mode - no real trading will occur');
    }

    // Start market monitoring
    await marketMonitor.start();

    // Start Express server
    app.listen(config.server.port, () => {
      logger.info(`✅ Server running on http://localhost:${config.server.port}`);
      logger.info(`📊 Trading enabled: ${config.trading.enabled}`);
      logger.info(`🎭 Mock mode: ${config.polymarket.useMock}`);
      logger.info(`💰 Min profit threshold: ${config.trading.minProfitThreshold * 100}%`);
      logger.info(`📈 Max position size: ${config.trading.maxPositionSize}`);
      logger.info(`🔄 Poll interval: ${config.monitoring.pollIntervalMs}ms`);
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
  await marketMonitor.stop();
  process.exit(0);
});

// Start the application
startServer();
