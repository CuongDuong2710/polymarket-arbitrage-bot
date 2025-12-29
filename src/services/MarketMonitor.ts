import EventEmitter from 'eventemitter3';
import { Market, MarketPrice } from '../models/Market';
import {
  MonitoringEventType,
  MarketEvent,
  PriceUpdateEvent,
  PriceSpikeEvent,
  MonitoringErrorEvent,
} from '../models/Events';
import PolymarketAPI from '../api/PolymarketAPI';
import MockPolymarketAPI from '../api/MockPolymarketAPI';
import MarketStateTracker from './MarketStateTracker';
import MonitoringStats from './MonitoringStats';
import config from '../config/config';
import logger from '../utils/logger';

/**
 * MarketMonitor is the heart of the bot's market monitoring system
 *
 * Responsibilities:
 * 1. Fetch markets from Polymarket API periodically
 * 2. Fetch prices for each market
 * 3. Track market states and price history
 * 4. Detect significant price changes (spikes)
 * 5.  Emit events when interesting things happen
 * 6. Collect performance statistics
 *
 * Architecture:
 * - Extends EventEmitter to notify other services of changes
 * - Uses polling (setInterval) to fetch data regularly
 * - Delegates state tracking to MarketStateTracker
 * - Delegates statistics to MonitoringStats
 * - Can use either real or mock API for testing
 */
export class MarketMonitor extends EventEmitter {
  // ========== DATA STORAGE ==========
  // Map of marketId -> Market for fast lookups
  private markets: Map<string, Market> = new Map();

  // Map of marketId -> MarketPrice[] for storing latest prices
  private prices: Map<string, MarketPrice[]> = new Map();

  // ========== STATE MANAGEMENT ==========
  // Whether monitoring is currently active
  private isRunning: boolean = false;

  // Timer handle for the polling interval (need to clear on stop)
  private pollInterval: NodeJS.Timeout | null = null;

  // ========== DEPENDENCIES ==========
  // API client (real or mock)
  private api: PolymarketAPI | MockPolymarketAPI;

  // Service to track market state and history
  private stateTracker: MarketStateTracker;

  // Service to collect performance statistics
  private stats: MonitoringStats;

  // ========== CONFIGURATION ==========
  // Threshold for detecting price spikes (5% = 0.05)
  // If a price changes more than this, we emit a PRICE_SPIKE event
  private readonly priceSpikeTreshold: number = 0.05;

  /**
   * Constructor initializes all dependencies
   * Doesn't start monitoring - call start() to begin
   */
  constructor() {
    // Initialize EventEmitter (enables event emission)
    super();

    // Choose API based on configuration
    // Mock API returns fake data for testing without real API calls
    this.api = config.polymarket.useMock ? new MockPolymarketAPI() : new PolymarketAPI();

    // Initialize state tracker and stats
    this.stateTracker = new MarketStateTracker();
    this.stats = new MonitoringStats();

    logger.info(
      `MarketMonitor initialized with ${config.polymarket.useMock ? 'Mock' : 'Real'} API`
    );
  }

  /**
   * Start monitoring markets
   *
   * Flow:
   * 1. Check if already running (prevent duplicate polling)
   * 2. Emit MONITORING_STARTED event
   * 3. Fetch markets immediately (don't wait for first interval)
   * 4. Set up interval to fetch periodically
   * 5. Set up statistics logging
   */
  async start(): Promise<void> {
    // Guard:  prevent starting twice
    if (this.isRunning) {
      logger.warn('MarketMonitor is already running');
      return;
    }

    this.isRunning = true;
    logger.info('MarketMonitor started');

    // Notify listeners that monitoring has started
    this.emit(MonitoringEventType.MONITORING_STARTED, {
      type: MonitoringEventType.MONITORING_STARTED,
      timestamp: new Date(),
    });

    // Do initial fetch immediately (don't wait for first interval)
    await this.fetchAndUpdateMarkets();

    // Set up periodic polling
    // This will call fetchAndUpdateMarkets every N milliseconds
    // (default: 5000ms = 5 seconds)
    this.pollInterval = setInterval(async () => {
      await this.fetchAndUpdateMarkets();
    }, config.monitoring.pollIntervalMs);

    // Log statistics every 5 minutes (300,000ms)
    // Helps monitor bot health in production
    setInterval(() => {
      this.stats.logStatistics();
    }, 300000);
  }

  /**
   * Stop monitoring markets
   *
   * Flow:
   * 1. Set running flag to false
   * 2. Clear the polling interval
   * 3. Emit MONITORING_STOPPED event
   */
  async stop(): Promise<void> {
    this.isRunning = false;

    // Clear the interval timer (stops polling)
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    // Notify listeners that monitoring has stopped
    this.emit(MonitoringEventType.MONITORING_STOPPED, {
      type: MonitoringEventType.MONITORING_STOPPED,
      timestamp: new Date(),
    });

    logger.info('MarketMonitor stopped');
  }

  /**
   * Main monitoring loop - fetches and processes all market data
   *
   * This is the "heartbeat" of the monitoring system
   * Called on startup and then every N seconds
   *
   * Flow:
   * 1. Fetch all markets from API
   * 2. Compare with previous markets to detect additions/removals
   * 3. For each market, fetch latest prices
   * 4. Update state tracker with new data
   * 5. Emit events for price updates and spikes
   * 6. Record statistics
   * 7. Handle any errors gracefully
   */
  private async fetchAndUpdateMarkets(): Promise<void> {
    try {
      // ========== STEP 1: FETCH MARKETS ==========
      const markets = await this.fetchMarkets();
      this.stats.recordMarketUpdate(markets.length);

      // ========== STEP 2: DETECT MARKET CHANGES ==========
      // Create sets of market IDs for easy comparison
      const currentMarketIds = new Set(markets.map((m) => m.id));
      const previousMarketIds = new Set(this.markets.keys());

      // Detect NEW markets (in current but not in previous)
      for (const market of markets) {
        if (!previousMarketIds.has(market.id)) {
          // This is a new market we haven't seen before!
          this.emitMarketAdded(market);
        }
        // Update our local cache
        this.markets.set(market.id, market);
      }

      // Detect REMOVED markets (in previous but not in current)
      for (const oldId of previousMarketIds) {
        if (!currentMarketIds.has(oldId)) {
          // This market is no longer active
          const oldMarket = this.markets.get(oldId);
          if (oldMarket) {
            this.emitMarketRemoved(oldMarket);
          }
          // Clean up from all data structures
          this.markets.delete(oldId);
          this.prices.delete(oldId);
          this.stateTracker.removeMarket(oldId);
        }
      }

      // ========== STEP 3: FETCH PRICES FOR EACH MARKET ==========
      for (const market of markets) {
        try {
          // Fetch latest prices for this market
          const prices = await this.fetchPrices(market.id);

          // Get previous prices (if any) for comparison
          const previousPrices = this.prices.get(market.id);

          // Update state tracker (maintains history)
          this.stateTracker.updateMarket(market, prices);

          // Store latest prices
          this.prices.set(market.id, prices);

          // Emit price update event (other services can listen for this)
          this.emitPriceUpdate(market.id, prices, previousPrices);

          // Check if any prices spiked dramatically
          this.checkPriceSpikes(market.id, prices, previousPrices);

          // Record successful price update in statistics
          this.stats.recordPriceUpdate();
        } catch (error) {
          // If price fetch fails for one market, log but continue with others
          logger.error(`Error fetching prices for market ${market.id}`, error);
          this.stats.recordError();
        }
      }

      logger.debug(`Updated ${markets.length} markets with prices`);
    } catch (error) {
      // If entire fetch cycle fails, log and emit error event
      logger.error('Error in fetchAndUpdateMarkets', error);
      this.stats.recordError();

      this.emit(MonitoringEventType.MONITORING_ERROR, {
        type: MonitoringEventType.MONITORING_ERROR,
        error: error as Error,
        context: 'fetchAndUpdateMarkets',
        timestamp: new Date(),
      } as MonitoringErrorEvent);
    }
  }

  // ========== API FETCHING METHODS ==========

  /**
   * Fetch all markets from the API
   *
   * Applies filters:
   * - Only active markets (not closed/resolved)
   * - Only markets with >$1000 liquidity (enough to trade)
   *
   * @returns Array of filtered markets
   */
  async fetchMarkets(): Promise<Market[]> {
    try {
      logger.debug('Fetching markets from Polymarket');

      // Fetch top 50 markets (configurable)
      const markets = await this.api.getMarkets(50, 0);

      // Filter for tradeable markets:
      // - active = market is still open for trading
      // - liquidity > 1000 = enough depth to execute trades
      const activeMarkets = markets.filter((m) => m.active && m.liquidity > 1000);

      logger.info(`Fetched ${activeMarkets.length} active markets`);
      return activeMarkets;
    } catch (error) {
      logger.error('Error fetching markets', error);
      return []; // Return empty array on error (graceful degradation)
    }
  }

  /**
   * Fetch prices for all outcomes in a specific market
   *
   * @param marketId - The market to get prices for
   * @returns Array of prices for each outcome
   */
  async fetchPrices(marketId: string): Promise<MarketPrice[]> {
    try {
      logger.debug(`Fetching prices for market ${marketId}`);
      const prices = await this.api.getMarketPrices(marketId);
      return prices;
    } catch (error) {
      logger.error(`Error fetching prices for market ${marketId}`, error);
      return []; // Return empty array on error
    }
  }

  // ========== EVENT EMISSION METHODS ==========

  /**
   * Emit event when a new market is discovered
   * Other services can listen for this to start tracking the market
   */
  private emitMarketAdded(market: Market): void {
    logger.info(`New market detected: ${market.question}`);

    this.emit(MonitoringEventType.MARKET_ADDED, {
      type: MonitoringEventType.MARKET_ADDED,
      market,
      timestamp: new Date(),
    } as MarketEvent);
  }

  /**
   * Emit event when a market is removed (closed/resolved)
   * Other services can clean up their tracking
   */
  private emitMarketRemoved(market: Market): void {
    logger.info(`Market removed: ${market.question}`);

    this.emit(MonitoringEventType.MARKET_REMOVED, {
      type: MonitoringEventType.MARKET_REMOVED,
      market,
      timestamp: new Date(),
    } as MarketEvent);
  }

  /**
   * Emit event when prices are updated
   * This happens frequently (every poll interval)
   *
   * Includes both current and previous prices so listeners can:
   * - Calculate price changes
   * - Detect arbitrage opportunities
   * - Update displays
   */
  private emitPriceUpdate(
    marketId: string,
    prices: MarketPrice[],
    previousPrices?: MarketPrice[]
  ): void {
    this.emit(MonitoringEventType.PRICE_UPDATED, {
      type: MonitoringEventType.PRICE_UPDATED,
      marketId,
      prices,
      previousPrices,
      timestamp: new Date(),
    } as PriceUpdateEvent);
  }

  /**
   * Check if any prices changed dramatically (spike detection)
   *
   * A "spike" is when a price changes more than the threshold (default 5%)
   * This could indicate:
   * - Breaking news affecting the market
   * - Large trade executed
   * - Market manipulation
   * - Arbitrage opportunity
   *
   * @param marketId - Which market to check
   * @param currentPrices - Latest prices
   * @param previousPrices - Prices from last update
   */
  private checkPriceSpikes(
    marketId: string,
    currentPrices: MarketPrice[],
    previousPrices?: MarketPrice[]
  ): void {
    // Can't detect spikes without previous prices
    if (!previousPrices) return;

    // Check each outcome for spikes
    for (const current of currentPrices) {
      // Find matching previous price for this outcome
      const previous = previousPrices.find((p) => p.outcome === current.outcome);

      if (!previous) continue;

      // Calculate absolute change
      const change = current.lastPrice - previous.lastPrice;

      // Calculate percentage change (absolute value)
      // Example: 0.50 -> 0.55 = 0.05 / 0.50 = 0.10 = 10%
      const changePercentage = Math.abs(change / previous.lastPrice);

      // If change exceeds threshold, emit spike event
      if (changePercentage >= this.priceSpikeTreshold) {
        logger.warn(
          `Price spike detected in market ${marketId}, outcome ${current.outcome}:  ${(changePercentage * 100).toFixed(2)}%`
        );

        this.emit(MonitoringEventType.PRICE_SPIKE, {
          type: MonitoringEventType.PRICE_SPIKE,
          marketId,
          outcome: current.outcome,
          oldPrice: previous.lastPrice,
          newPrice: current.lastPrice,
          change,
          changePercentage,
          timestamp: new Date(),
        } as PriceSpikeEvent);
      }
    }
  }

  // ========== PUBLIC GETTER METHODS ==========
  // These allow other parts of the app to access monitored data

  /**
   * Get all markets currently being monitored
   * @returns Array of all markets
   */
  getMarkets(): Market[] {
    return Array.from(this.markets.values());
  }

  /**
   * Get a specific market by ID
   * @returns The market, or undefined if not found
   */
  getMarket(marketId: string): Market | undefined {
    return this.markets.get(marketId);
  }

  /**
   * Get latest prices for a specific market
   * @returns Array of prices, or empty array if not found
   */
  getPrices(marketId: string): MarketPrice[] {
    return this.prices.get(marketId) || [];
  }

  /**
   * Get all prices for all markets
   * Useful for bulk analysis
   */
  getAllPrices(): Map<string, MarketPrice[]> {
    return this.prices;
  }

  /**
   * Get detailed state for a specific market
   * Includes history, volatility, spread, etc.
   */
  getMarketState(marketId: string) {
    return this.stateTracker.getState(marketId);
  }

  /**
   * Get states for all markets
   * Useful for dashboards and analytics
   */
  getAllMarketStates() {
    return this.stateTracker.getAllStates();
  }

  /**
   * Get performance statistics
   * Shows how well the monitoring system is performing
   */
  getStatistics() {
    return this.stats.getStatistics();
  }

  /**
   * Get markets with highest volatility
   * These are most likely to have arbitrage opportunities
   *
   * @param limit - How many to return (default 10)
   */
  getTopVolatileMarkets(limit: number = 10) {
    return this.stateTracker.getTopVolatileMarkets(limit);
  }

  /**
   * Get trending markets (highest volume)
   * These have the most trading activity
   */
  async getTrendingMarkets(): Promise<Market[]> {
    try {
      return await this.api.getTrendingMarkets(20);
    } catch (error) {
      logger.error('Error fetching trending markets', error);
      return [];
    }
  }

  /**
   * Check if monitoring is currently active
   * @returns true if monitoring, false if stopped
   */
  isMonitoring(): boolean {
    return this.isRunning;
  }
}

export default MarketMonitor;
