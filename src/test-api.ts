import PolymarketAPI from './api/PolymarketAPI';
import MockPolymarketAPI from './api/MockPolymarketAPI';
import logger from './utils/logger';
import config from './config/config';

async function testAPI() {
  const api = config.polymarket.useMock ? new MockPolymarketAPI() : new PolymarketAPI();

  logger.info('Testing Polymarket API integration...\n');

  try {
    // Test 1: Health check
    logger.info('Test 1: Health Check');
    const isHealthy = await api.healthCheck();
    logger.info(`API Health: ${isHealthy ? '✅ Healthy' : '❌ Unhealthy'}\n`);

    // Test 2: Fetch markets
    logger.info('Test 2: Fetch Markets');
    const markets = await api.getMarkets(5, 0);
    logger.info(`Fetched ${markets.length} markets:`);
    markets.forEach((m) => {
      logger.info(`  - ${m.question} (${m.id})`);
      logger.info(`    Volume: $${m.volume.toFixed(2)}, Liquidity: $${m.liquidity.toFixed(2)}`);
    });
    logger.info('');

    // Test 3: Fetch prices for first market
    if (markets.length > 0) {
      const firstMarket = markets[0];
      logger.info(`Test 3: Fetch Prices for "${firstMarket.question}"`);
      const prices = await api.getMarketPrices(firstMarket.id);
      logger.info(`Fetched ${prices.length} prices:`);
      prices.forEach((p) => {
        logger.info(`  - ${p.outcome}:`);
        logger.info(
          `    Bid: ${p.bidPrice.toFixed(4)}, Ask: ${p.askPrice.toFixed(4)}, Last: ${p.lastPrice.toFixed(4)}`
        );
      });
      logger.info('');
    }

    // Test 4: Fetch trending markets
    logger.info('Test 4: Fetch Trending Markets');
    const trending = await api.getTrendingMarkets(3);
    logger.info(`Fetched ${trending.length} trending markets:`);
    trending.forEach((m) => {
      logger.info(`  - ${m.question}`);
      logger.info(`    Volume: $${m.volume.toFixed(2)}`);
    });

    logger.info('\n✅ All tests passed!');
  } catch (error) {
    logger.error('❌ Test failed:', error);
  }
}

testAPI();
