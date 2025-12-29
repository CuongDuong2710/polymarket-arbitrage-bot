import logger from '../utils/logger';

/**
 * Statistics about the monitoring system's performance
 * This helps us understand how well the bot is running
 */
export interface MonitoringStatistics {
  startTime: Date; // When monitoring started
  uptime: number; // How long it's been running (seconds)
  totalMarkets: number; // Total markets being monitored
  activeMarkets: number; // Markets currently active
  totalPriceUpdates: number; // Total price fetches since start
  totalErrors: number; // How many errors occurred
  averageUpdateInterval: number; // Average time between updates (seconds)
  lastUpdateTime: Date | null; // When we last updated prices
  marketsPerSecond: number; // Processing rate
  updatesPerMinute: number; // Recent update frequency
}

/**
 * MonitoringStats tracks performance metrics of the monitoring system
 *
 * Think of it as a "fitness tracker" for your bot:
 * - How long has it been running?
 * - How fast is it processing data?
 * - How many errors occurred?
 * - Is it keeping up with the configured poll interval?
 */
export class MonitoringStats {
  // When the monitoring started
  private startTime: Date = new Date();

  // Counters for various metrics
  private totalMarkets: number = 0;
  private activeMarkets: number = 0;
  private totalPriceUpdates: number = 0;
  private totalErrors: number = 0;

  // Array of recent update timestamps for calculating rates
  private updateTimestamps: Date[] = [];

  // When the last update occurred
  private lastUpdateTime: Date | null = null;

  // How many timestamps to keep (limits memory usage)
  private readonly maxTimestamps: number = 100;

  /**
   * Record that we updated market data
   * Call this after fetching markets from the API
   *
   * @param marketCount - How many markets we're now monitoring
   */
  recordMarketUpdate(marketCount: number): void {
    this.totalMarkets = marketCount;
    this.activeMarkets = marketCount;
    this.lastUpdateTime = new Date();
  }

  /**
   * Record that we updated prices for a market
   * Call this after successfully fetching prices
   *
   * This tracks:
   * - Total number of price updates (cumulative)
   * - Timing of updates (for calculating rates)
   */
  recordPriceUpdate(): void {
    // Increment total counter
    this.totalPriceUpdates++;

    // Add timestamp to our rolling window
    this.updateTimestamps.push(new Date());

    // Keep only recent timestamps (prevents memory leak)
    // Like a sliding window - remove oldest when we have too many
    if (this.updateTimestamps.length > this.maxTimestamps) {
      this.updateTimestamps.shift(); // Remove oldest
    }

    this.lastUpdateTime = new Date();
  }

  /**
   * Record that an error occurred
   * Call this whenever an exception is caught
   */
  recordError(): void {
    this.totalErrors++;
  }

  /**
   * Get current statistics snapshot
   * This compiles all metrics into one object
   *
   * @returns Complete statistics object
   */
  getStatistics(): MonitoringStatistics {
    const now = new Date();

    // Calculate uptime in seconds
    const uptime = (now.getTime() - this.startTime.getTime()) / 1000;

    return {
      startTime: this.startTime,
      uptime,
      totalMarkets: this.totalMarkets,
      activeMarkets: this.activeMarkets,
      totalPriceUpdates: this.totalPriceUpdates,
      totalErrors: this.totalErrors,
      averageUpdateInterval: this.calculateAverageInterval(),
      lastUpdateTime: this.lastUpdateTime,
      marketsPerSecond: this.totalMarkets / uptime,
      updatesPerMinute: this.calculateUpdatesPerMinute(),
    };
  }

  /**
   * Calculate average time between updates
   *
   * Example: If updates happen at:
   * - 10:00:00
   * - 10:00:05
   * - 10:00:10
   * Intervals are [5s, 5s], average = 5 seconds
   *
   * This helps detect if polling is slower than configured
   * (e.g., if config says 5s but actual average is 8s, API is slow)
   */
  private calculateAverageInterval(): number {
    // Need at least 2 updates to calculate interval
    if (this.updateTimestamps.length < 2) return 0;

    const intervals: number[] = [];

    // Calculate interval between each consecutive pair
    for (let i = 1; i < this.updateTimestamps.length; i++) {
      const interval = this.updateTimestamps[i].getTime() - this.updateTimestamps[i - 1].getTime();
      intervals.push(interval);
    }

    // Calculate average interval in milliseconds
    const avgInterval = intervals.reduce((sum, i) => sum + i, 0) / intervals.length;

    // Convert to seconds and return
    return avgInterval / 1000;
  }

  /**
   * Calculate how many updates happened in the last minute
   * This gives a real-time view of update frequency
   *
   * Useful for monitoring if the bot is keeping up with load
   * Example: If polling is every 5 seconds, expect ~12 updates/minute
   */
  private calculateUpdatesPerMinute(): number {
    if (this.updateTimestamps.length === 0) return 0;

    const now = new Date();
    const oneMinuteAgo = new Date(now.getTime() - 60000); // 60,000ms = 1 minute

    // Filter timestamps to only those in the last minute
    const recentUpdates = this.updateTimestamps.filter((ts) => ts >= oneMinuteAgo);

    return recentUpdates.length;
  }

  /**
   * Reset all statistics
   * Useful for testing or restarting monitoring
   */
  reset(): void {
    this.startTime = new Date();
    this.totalMarkets = 0;
    this.activeMarkets = 0;
    this.totalPriceUpdates = 0;
    this.totalErrors = 0;
    this.updateTimestamps = [];
    this.lastUpdateTime = null;
    logger.info('Monitoring statistics reset');
  }

  /**
   * Log current statistics to console
   * Useful for debugging and monitoring health
   *
   * Call this periodically (e.g., every 5 minutes) to see how the bot is doing
   */
  logStatistics(): void {
    const stats = this.getStatistics();

    logger.info('=== Monitoring Statistics ===');
    logger.info(`Uptime: ${stats.uptime.toFixed(0)}s`);
    logger.info(`Total Markets: ${stats.totalMarkets}`);
    logger.info(`Active Markets: ${stats.activeMarkets}`);
    logger.info(`Total Price Updates: ${stats.totalPriceUpdates}`);
    logger.info(`Total Errors: ${stats.totalErrors}`);
    logger.info(`Updates/Minute: ${stats.updatesPerMinute.toFixed(1)}`);
    logger.info(`Avg Update Interval: ${stats.averageUpdateInterval.toFixed(2)}s`);
    logger.info('============================');
  }
}

export default MonitoringStats;
