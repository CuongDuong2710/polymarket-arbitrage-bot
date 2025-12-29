import MarketMonitor from './services/MarketMonitor';
import { MonitoringEventType } from './models/Events';
import logger from './utils/logger';

async function testMonitoring() {
  logger.info('Testing Enhanced Market Monitoring...\n');

  const monitor = new MarketMonitor();

  // Set up event listeners
  monitor.on(MonitoringEventType.MONITORING_STARTED, () => {
    logger.info('✅ Monitoring started');
  });

  monitor.on(MonitoringEventType.MARKET_ADDED, (event) => {
    logger.info(`📈 Market added: ${event.market.question}`);
  });

  monitor.on(MonitoringEventType.PRICE_UPDATED, (event) => {
    logger.info(`💵 Prices updated for market:  ${event.marketId}`);
  });

  monitor.on(MonitoringEventType.PRICE_SPIKE, (event) => {
    logger.warn(`🚨 PRICE SPIKE: ${event.outcome} - ${(event.changePercentage * 100).toFixed(2)}%`);
  });

  monitor.on(MonitoringEventType.MONITORING_ERROR, (event) => {
    logger.error(`❌ Error: ${event.error.message}`);
  });

  // Start monitoring
  await monitor.start();

  // Let it run for 30 seconds
  setTimeout(async () => {
    logger.info('\n=== Final Statistics ===');
    const stats = monitor.getStatistics();
    logger.info(`Uptime: ${stats.uptime.toFixed(0)}s`);
    logger.info(`Total Markets: ${stats.totalMarkets}`);
    logger.info(`Price Updates: ${stats.totalPriceUpdates}`);
    logger.info(`Updates/Minute: ${stats.updatesPerMinute.toFixed(1)}`);
    logger.info(`Errors: ${stats.totalErrors}`);

    logger.info('\n=== Top Volatile Markets ===');
    const volatile = monitor.getTopVolatileMarkets(3);
    volatile.forEach((state, index) => {
      logger.info(`${index + 1}. ${state.market.question}`);
      logger.info(`   Volatility: ${state.volatility.toFixed(4)}`);
      logger.info(`   Avg Spread: ${state.averageSpread.toFixed(4)}`);
    });

    await monitor.stop();
    process.exit(0);
  }, 30000);
}

testMonitoring().catch((error) => {
  logger.error('Test failed:', error);
  process.exit(1);
});
