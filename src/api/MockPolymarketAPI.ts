import { Market, MarketPrice } from '../models/Market';
import logger from '../utils/logger';

/**
 * Mock Polymarket API for testing and development
 */
export class MockPolymarketAPI {
  private mockMarkets: Market[] = [];

  constructor() {
    this.initializeMockData();
    logger.info('MockPolymarketAPI initialized');
  }

  private initializeMockData(): void {
    this.mockMarkets = [
      {
        id: 'mock-market-1',
        question: 'Will Bitcoin reach $100,000 by end of 2025?',
        description: 'This market resolves to Yes if Bitcoin price reaches $100,000 USD.',
        endDate: new Date('2025-12-31'),
        outcomes: ['Yes', 'No'],
        active: true,
        volume: 150000,
        liquidity: 50000,
      },
      {
        id: 'mock-market-2',
        question: 'Will Ethereum 2.0 launch successfully in Q1 2025?',
        description: 'Market resolves based on official Ethereum Foundation announcement.',
        endDate: new Date('2025-03-31'),
        outcomes: ['Yes', 'No'],
        active: true,
        volume: 80000,
        liquidity: 30000,
      },
      {
        id: 'mock-market-3',
        question: 'US Presidential Election 2024',
        description: 'Who will win the 2024 US Presidential Election?',
        endDate: new Date('2024-11-05'),
        outcomes: ['Republican', 'Democrat', 'Other'],
        active: true,
        volume: 500000,
        liquidity: 200000,
      },
    ];
  }

  async getMarkets(limit: number = 100, offset: number = 0): Promise<Market[]> {
    logger.debug(`Mock:  Fetching markets (limit: ${limit}, offset:  ${offset})`);
    return this.mockMarkets.slice(offset, offset + limit);
  }

  async getMarket(marketId: string): Promise<Market> {
    logger.debug(`Mock: Fetching market: ${marketId}`);
    const market = this.mockMarkets.find((m) => m.id === marketId);

    if (!market) {
      throw new Error(`Market not found: ${marketId}`);
    }

    return market;
  }

  async getMarketPrices(marketId: string): Promise<MarketPrice[]> {
    logger.debug(`Mock: Fetching prices for market: ${marketId}`);

    const market = await this.getMarket(marketId);
    const prices: MarketPrice[] = [];

    // Generate mock prices with some variance
    for (const outcome of market.outcomes) {
      const basePrice = 0.5;
      const variance = (Math.random() - 0.5) * 0.2; // ±10%
      const lastPrice = Math.max(0.1, Math.min(0.9, basePrice + variance));

      const spread = 0.02; // 2% spread
      const bidPrice = Math.max(0.01, lastPrice - spread / 2);
      const askPrice = Math.min(0.99, lastPrice + spread / 2);

      prices.push({
        marketId,
        outcome,
        bidPrice,
        askPrice,
        lastPrice,
        timestamp: new Date(),
      });
    }

    return prices;
  }

  async getTrendingMarkets(limit: number = 20): Promise<Market[]> {
    logger.debug(`Mock: Fetching trending markets (limit: ${limit})`);
    return [...this.mockMarkets].sort((a, b) => b.volume - a.volume).slice(0, limit);
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

export default MockPolymarketAPI;
