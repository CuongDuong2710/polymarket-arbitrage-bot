import { Market, MarketPrice } from '../models/Market';
import logger from '../utils/logger';

/**
 * Represents the complete state of a market including its history
 * This is like a "memory" of everything we know about a market
 */
export interface MarketState {
  market: Market; // Current market information
  prices: MarketPrice[]; // Latest prices for all outcomes
  priceHistory: MarketPrice[][]; // Historical price snapshots (array of price arrays)
  lastUpdate: Date; // When we last updated this market
  updateCount: number; // How many times we've updated (useful for debugging)
  averageSpread: number; // Average bid-ask spread (lower = more liquid)
  volatility: number; // How much prices fluctuate (higher = more volatile)
}

/**
 * MarketStateTracker keeps track of all markets and their historical data
 *
 * Think of it as a historian that remembers:
 * - What markets exist
 * - How prices have changed over time
 * - Which markets are volatile
 * - Which markets have good liquidity (tight spreads)
 */
export class MarketStateTracker {
  // Map of marketId -> MarketState
  // We use Map instead of object for better performance with many markets
  private states: Map<string, MarketState> = new Map();

  // How many historical price snapshots to keep per market
  // 100 snapshots * 5 second intervals = ~8 minutes of history
  private readonly maxHistoryLength: number = 100;

  /**
   * Update or create the state for a market
   * Called every time we fetch new prices
   *
   * @param market - The market to update
   * @param prices - New prices for this market
   * @returns The updated state
   */
  updateMarket(market: Market, prices: MarketPrice[]): MarketState {
    const existing = this.states.get(market.id);

    if (existing) {
      // ========== UPDATING EXISTING MARKET ==========

      // Add new prices to history
      const priceHistory = [...existing.priceHistory, prices];

      // Keep only the last N snapshots to prevent memory bloat
      // Like a rolling window - remove oldest when we have too many
      if (priceHistory.length > this.maxHistoryLength) {
        priceHistory.shift(); // Remove the oldest snapshot
      }

      // Calculate updated metrics
      const state: MarketState = {
        market, // Latest market info
        prices, // Latest prices
        priceHistory, // Full history
        lastUpdate: new Date(), // Current timestamp
        updateCount: existing.updateCount + 1, // Increment counter
        averageSpread: this.calculateAverageSpread(prices), // Recalculate spread
        volatility: this.calculateVolatility(priceHistory), // Recalculate volatility
      };

      this.states.set(market.id, state);
      return state;
    } else {
      // ========== CREATING NEW MARKET ==========

      const state: MarketState = {
        market,
        prices,
        priceHistory: [prices], // Start with one snapshot
        lastUpdate: new Date(),
        updateCount: 1, // First update
        averageSpread: this.calculateAverageSpread(prices),
        volatility: 0, // Can't calculate volatility with only one data point
      };

      this.states.set(market.id, state);
      logger.info(`Started tracking market: ${market.question}`);
      return state;
    }
  }

  /**
   * Get the state for a specific market
   * Returns undefined if we're not tracking this market
   */
  getState(marketId: string): MarketState | undefined {
    return this.states.get(marketId);
  }

  /**
   * Get all market states we're currently tracking
   * Useful for dashboards and analytics
   */
  getAllStates(): MarketState[] {
    return Array.from(this.states.values());
  }

  /**
   * Stop tracking a market (when it closes or is removed)
   * @returns true if market was removed, false if it didn't exist
   */
  removeMarket(marketId: string): boolean {
    return this.states.delete(marketId);
  }

  /**
   * Calculate how much a price has changed since last update
   *
   * Example: If "Yes" was 0.50 and now is 0.55, returns 0.05
   *
   * @returns The price change, or null if we don't have enough data
   */
  getPriceChange(marketId: string, outcome: string): number | null {
    const state = this.states.get(marketId);

    // Need at least 2 price snapshots to calculate change
    if (!state || state.priceHistory.length < 2) {
      return null;
    }

    // Get current price for this outcome
    const current = state.prices.find((p) => p.outcome === outcome);

    // Get previous price (second-to-last snapshot)
    const previous = state.priceHistory[state.priceHistory.length - 2].find(
      (p) => p.outcome === outcome
    );

    if (!current || !previous) {
      return null;
    }

    // Return absolute change (can be negative)
    return current.lastPrice - previous.lastPrice;
  }

  /**
   * Calculate percentage change in price
   *
   * Example: If "Yes" went from 0.50 to 0.55:
   * Change = 0.05, Percentage = (0.05 / 0.50) * 100 = 10%
   *
   * @returns The percentage change (e.g., 10 for 10%), or null if insufficient data
   */
  getPriceChangePercentage(marketId: string, outcome: string): number | null {
    const state = this.states.get(marketId);
    if (!state || state.priceHistory.length < 2) {
      return null;
    }

    const current = state.prices.find((p) => p.outcome === outcome);
    const previous = state.priceHistory[state.priceHistory.length - 2].find(
      (p) => p.outcome === outcome
    );

    // Avoid division by zero
    if (!current || !previous || previous.lastPrice === 0) {
      return null;
    }

    // Calculate percentage:  (new - old) / old * 100
    return ((current.lastPrice - previous.lastPrice) / previous.lastPrice) * 100;
  }

  /**
   * Calculate the average bid-ask spread for all outcomes
   *
   * Spread = Ask Price - Bid Price
   * Lower spread = More liquid market (easier to trade)
   * Higher spread = Less liquid (harder to trade without losing money)
   *
   * Example:
   * - Outcome A:  Bid=0.48, Ask=0.52, Spread=0.04
   * - Outcome B: Bid=0.46, Ask=0.50, Spread=0.04
   * - Average Spread = (0.04 + 0.04) / 2 = 0.04
   */
  private calculateAverageSpread(prices: MarketPrice[]): number {
    if (prices.length === 0) return 0;

    // Calculate spread for each outcome
    const spreads = prices.map((p) => p.askPrice - p.bidPrice);

    // Return average
    return spreads.reduce((sum, spread) => sum + spread, 0) / spreads.length;
  }

  /**
   * Calculate volatility (how much prices bounce around)
   * Uses standard deviation of all historical prices
   *
   * High volatility = Prices change a lot (more risk, but more opportunity)
   * Low volatility = Prices stay stable (less risk, fewer opportunities)
   *
   * This uses statistical standard deviation:
   * 1. Calculate mean (average) of all prices
   * 2. Calculate variance (average squared difference from mean)
   * 3. Take square root of variance = standard deviation
   */
  private calculateVolatility(priceHistory: MarketPrice[][]): number {
    // Need at least 2 snapshots to measure volatility
    if (priceHistory.length < 2) return 0;

    // Flatten all historical prices into one array
    const allPrices: number[] = [];
    for (const snapshot of priceHistory) {
      for (const price of snapshot) {
        allPrices.push(price.lastPrice);
      }
    }

    // Step 1: Calculate mean (average price)
    const mean = allPrices.reduce((sum, p) => sum + p, 0) / allPrices.length;

    // Step 2: Calculate variance
    // For each price, calculate (price - mean)² and average them
    const variance =
      allPrices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / allPrices.length;

    // Step 3: Return standard deviation (square root of variance)
    return Math.sqrt(variance);
  }

  /**
   * Get markets sorted by volatility (most volatile first)
   * Useful for finding markets with big price movements
   *
   * @param limit - How many markets to return
   */
  getTopVolatileMarkets(limit: number = 10): MarketState[] {
    return Array.from(this.states.values())
      .sort((a, b) => b.volatility - a.volatility) // Sort descending
      .slice(0, limit); // Take top N
  }

  /**
   * Filter markets by minimum liquidity
   * Only returns markets with enough liquidity to trade safely
   *
   * @param minLiquidity - Minimum liquidity in USDC (e.g., 1000)
   */
  getMarketsByLiquidity(minLiquidity: number): MarketState[] {
    return Array.from(this.states.values()).filter(
      (state) => state.market.liquidity >= minLiquidity
    );
  }

  /**
   * Clear all tracked markets
   * Useful for restarting or testing
   */
  clear(): void {
    this.states.clear();
    logger.info('Cleared all market states');
  }
}

export default MarketStateTracker;
