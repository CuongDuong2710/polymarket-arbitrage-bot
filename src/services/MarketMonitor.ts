import { Market, MarketPrice } from '../models/Market';
import PolymarketAPI from '../api/PolymarketAPI';
import MockPolymarketAPI from '../api/MockPolymarketAPI';
import config from '../config/config';
import logger from '../utils/logger';

export class MarketMonitor {
  private markets: Map<string, Market> = new Map();
  private prices: Map<string, MarketPrice[]> = new Map();
  private isRunning: boolean = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private api: PolymarketAPI | MockPolymarketAPI;

  constructor() {
    // Use mock API or real API based on configuration
    this.api = config.polymarket.useMock ? new MockPolymarketAPI() : new PolymarketAPI();
    logger.info(
      `MarketMonitor initialized with ${config.polymarket.useMock ? 'Mock' : 'Real'} API`
    );
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('MarketMonitor is already running');
      return;
    }

    this.isRunning = true;
    logger.info('MarketMonitor started');

    // Initial fetch
    await this.fetchAndUpdateMarkets();

    // Set up polling
    this.pollInterval = setInterval(async () => {
      await this.fetchAndUpdateMarkets();
    }, config.monitoring.pollIntervalMs);
  }

  async stop(): Promise<void> {
    this.isRunning = false;

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    logger.info('MarketMonitor stopped');
  }

  private async fetchAndUpdateMarkets(): Promise<void> {
    try {
      // Fetch markets
      const markets = await this.fetchMarkets();

      // Update local cache
      for (const market of markets) {
        this.markets.set(market.id, market);

        // Fetch prices for each market
        const prices = await this.fetchPrices(market.id);
        this.prices.set(market.id, prices);
      }

      logger.info(`Updated ${markets.length} markets with prices`);
    } catch (error) {
      logger.error('Error in fetchAndUpdateMarkets', error);
    }
  }

  async fetchMarkets(): Promise<Market[]> {
    try {
      logger.debug('Fetching markets from Polymarket');
      const markets = await this.api.getMarkets(50, 0); // Fetch top 50 markets

      // Filter for active markets with good liquidity
      const activeMarkets = markets.filter(
        (m) => m.active && m.liquidity > 1000 // Only markets with >$1000 liquidity
      );

      logger.info(`Fetched ${activeMarkets.length} active markets`);
      return activeMarkets;
    } catch (error) {
      logger.error('Error fetching markets', error);
      return [];
    }
  }

  async fetchPrices(marketId: string): Promise<MarketPrice[]> {
    try {
      logger.debug(`Fetching prices for market ${marketId}`);
      const prices = await this.api.getMarketPrices(marketId);
      return prices;
    } catch (error) {
      logger.error(`Error fetching prices for market ${marketId}`, error);
      return [];
    }
  }

  getMarkets(): Market[] {
    return Array.from(this.markets.values());
  }

  getMarket(marketId: string): Market | undefined {
    return this.markets.get(marketId);
  }

  getPrices(marketId: string): MarketPrice[] {
    return this.prices.get(marketId) || [];
  }

  getAllPrices(): Map<string, MarketPrice[]> {
    return this.prices;
  }

  async getTrendingMarkets(): Promise<Market[]> {
    try {
      return await this.api.getTrendingMarkets(20);
    } catch (error) {
      logger.error('Error fetching trending markets', error);
      return [];
    }
  }
}

export default MarketMonitor;
