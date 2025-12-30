import { v4 as uuidv4 } from 'uuid';
import { Trade, TradeStatus, TradeType, Position } from '../models/Trade';
import { ArbitrageOpportunity, ArbitrageType } from '../models/Market';
import config from '../config/config';
import logger from '../utils/logger';

/**
 * TradeExecutor handles execution of arbitrage opportunities
 *
 * Responsibilities:
 * 1. Convert opportunities into executable trades
 * 2. Validate trades before execution
 * 3. Execute trades (or simulate in dry-run mode)
 * 4. Track trade status and outcomes
 * 5. Handle errors and retries
 * 6. Update positions
 *
 * Safety Features:
 * - Dry-run mode (no real trades)
 * - Pre-execution validation
 * - Position tracking
 * - Error handling with retries
 * - Detailed logging
 */
export class TradeExecutor {
  // Active trades waiting for execution or confirmation
  private pendingTrades: Trade[] = [];

  // Completed trades (success or failure)
  private completedTrades: Trade[] = [];

  // Maximum number of concurrent pending trades
  private readonly maxPendingTrades: number = 10;

  // Maximum retries for failed trades
  private readonly maxRetries: number = 3;

  // Track retry counts per trade
  private retryCount: Map<string, number> = new Map();

  constructor() {
    logger.info('TradeExecutor initialized');
    logger.info(`Trading enabled: ${config.trading.enabled}`);
    logger.info(`Dry-run mode: ${!config.trading.enabled}`);
  }

  /**
   * Execute an arbitrage opportunity
   *
   * Process:
   * 1. Validate opportunity is still valid
   * 2. Convert opportunity to trade(s)
   * 3. Execute trades (or simulate if dry-run)
   * 4. Track execution status
   * 5. Return executed trades
   *
   * @param opportunity - The arbitrage opportunity to execute
   * @returns Array of executed trades
   */
  async executeTrade(opportunity: ArbitrageOpportunity): Promise<Trade[]> {
    logger.info(`Attempting to execute arbitrage opportunity: ${opportunity.id}`);
    logger.info(
      `Type: ${opportunity.type}, Profit: $${opportunity.expectedProfit.toFixed(4)} (${(opportunity.profitPercentage * 100).toFixed(2)}%)`
    );

    // ========== VALIDATION ==========

    // Check if trading is enabled
    if (!config.trading.enabled) {
      logger.warn('Trading is disabled.  Simulating trade execution.');
      return this.simulateTrade(opportunity);
    }

    // Check if opportunity has expired
    if (opportunity.expiresAt && new Date() > opportunity.expiresAt) {
      logger.warn(`Opportunity ${opportunity.id} has expired`);
      return [];
    }

    // Check if we have capacity for more pending trades
    if (this.pendingTrades.length >= this.maxPendingTrades) {
      logger.warn(`Maximum pending trades reached (${this.maxPendingTrades}). Skipping execution.`);
      return [];
    }

    // ========== TRADE CREATION ==========

    const trades: Trade[] = [];

    // Create trades based on arbitrage type
    switch (opportunity.type) {
      case ArbitrageType.COMPLEMENTARY:
        // Buy all outcomes
        trades.push(...this.createComplementaryTrades(opportunity));
        break;

      case ArbitrageType.MISPRICING:
        // Buy and immediately sell
        trades.push(...this.createMispricingTrades(opportunity));
        break;

      case ArbitrageType.TEMPORAL:
        // Sell outcomes (more complex)
        trades.push(...this.createTemporalTrades(opportunity));
        break;

      default:
        logger.error(`Unknown arbitrage type: ${opportunity.type}`);
        return [];
    }

    // ========== EXECUTION ==========

    const executedTrades: Trade[] = [];

    for (const trade of trades) {
      try {
        // Add to pending
        this.pendingTrades.push(trade);

        // Execute the trade
        const result = await this.executeIndividualTrade(trade);

        if (result.status === TradeStatus.EXECUTED) {
          logger.info(`✅ Trade executed successfully: ${result.id}`);
          executedTrades.push(result);

          // Move from pending to completed
          this.pendingTrades = this.pendingTrades.filter((t) => t.id !== result.id);
          this.completedTrades.push(result);
        } else {
          logger.error(`❌ Trade execution failed: ${result.id} - ${result.error}`);

          // Check if we should retry
          if (this.shouldRetry(trade)) {
            logger.info(`Retrying trade ${trade.id}...`);
            // Add back to pending for retry
          } else {
            // Move to completed as failed
            this.pendingTrades = this.pendingTrades.filter((t) => t.id !== trade.id);
            this.completedTrades.push(result);
          }
        }
      } catch (error) {
        logger.error(`Exception executing trade ${trade.id}:`, error);

        // Update trade status
        trade.status = TradeStatus.FAILED;
        trade.error = error instanceof Error ? error.message : 'Unknown error';

        // Move to completed
        this.pendingTrades = this.pendingTrades.filter((t) => t.id !== trade.id);
        this.completedTrades.push(trade);
      }
    }

    // Log summary
    const successCount = executedTrades.filter((t) => t.status === TradeStatus.EXECUTED).length;
    const failCount = trades.length - successCount;

    logger.info(`Trade execution summary: ${successCount} successful, ${failCount} failed`);

    return executedTrades;
  }

  /**
   * Create trades for complementary arbitrage
   *
   * Strategy:  Buy all outcomes
   * Example: Buy "Yes" + "No" for total < $1. 00
   *
   * @param opportunity - The arbitrage opportunity
   * @returns Array of buy trades
   */
  private createComplementaryTrades(opportunity: ArbitrageOpportunity): Trade[] {
    const trades: Trade[] = [];

    // Parse outcomes (e.g., "Yes + No" or "All 3 outcomes")
    const outcomes = opportunity.buyOutcome.includes('+')
      ? opportunity.buyOutcome.split(' + ')
      : [opportunity.buyOutcome];

    // Create a buy trade for each outcome
    // For simplicity, split capital equally across outcomes
    const amountPerOutcome = opportunity.requiredCapital / outcomes.length;

    for (const outcome of outcomes) {
      const trade: Trade = {
        id: uuidv4(),
        marketId: opportunity.marketId,
        outcome: outcome.trim(),
        type: TradeType.BUY,
        amount: amountPerOutcome,
        price: opportunity.buyPrice / outcomes.length, // Approximate
        status: TradeStatus.PENDING,
        createdAt: new Date(),
      };

      trades.push(trade);
      logger.debug(
        `Created complementary buy trade: ${outcome} for $${amountPerOutcome.toFixed(4)}`
      );
    }

    return trades;
  }

  /**
   * Create trades for mispricing arbitrage
   *
   * Strategy:  Buy at ask, sell at bid (when bid > ask)
   *
   * @param opportunity - The arbitrage opportunity
   * @returns Array of buy and sell trades
   */
  private createMispricingTrades(opportunity: ArbitrageOpportunity): Trade[] {
    const trades: Trade[] = [];

    // Create buy trade
    const buyTrade: Trade = {
      id: uuidv4(),
      marketId: opportunity.marketId,
      outcome: opportunity.buyOutcome,
      type: TradeType.BUY,
      amount: opportunity.requiredCapital,
      price: opportunity.buyPrice,
      status: TradeStatus.PENDING,
      createdAt: new Date(),
    };
    trades.push(buyTrade);

    // Create sell trade (to be executed after buy completes)
    const sellTrade: Trade = {
      id: uuidv4(),
      marketId: opportunity.marketId,
      outcome: opportunity.sellOutcome,
      type: TradeType.SELL,
      amount: opportunity.requiredCapital,
      price: opportunity.sellPrice,
      status: TradeStatus.PENDING,
      createdAt: new Date(),
    };
    trades.push(sellTrade);

    logger.debug(
      `Created mispricing trades: Buy at $${opportunity.buyPrice.toFixed(4)}, Sell at $${opportunity.sellPrice.toFixed(4)}`
    );

    return trades;
  }

  /**
   * Create trades for temporal arbitrage
   *
   * Strategy:  Sell outcomes when total > $1.00
   * NOTE: This requires already owning the outcomes or shorting
   *
   * @param opportunity - The arbitrage opportunity
   * @returns Array of sell trades
   */
  private createTemporalTrades(opportunity: ArbitrageOpportunity): Trade[] {
    const trades: Trade[] = [];

    // Parse outcomes
    const outcomes = opportunity.sellOutcome.includes('+')
      ? opportunity.sellOutcome.split(' + ')
      : [opportunity.sellOutcome];

    const amountPerOutcome = opportunity.requiredCapital / outcomes.length;

    for (const outcome of outcomes) {
      const trade: Trade = {
        id: uuidv4(),
        marketId: opportunity.marketId,
        outcome: outcome.trim(),
        type: TradeType.SELL,
        amount: amountPerOutcome,
        price: opportunity.sellPrice / outcomes.length,
        status: TradeStatus.PENDING,
        createdAt: new Date(),
      };

      trades.push(trade);
      logger.debug(`Created temporal sell trade: ${outcome} for $${amountPerOutcome.toFixed(4)}`);
    }

    return trades;
  }

  /**
   * Execute a single trade
   *
   * In production, this would:
   * 1. Connect to Polymarket API
   * 2. Create signed order
   * 3. Submit order to order book
   * 4. Wait for confirmation
   * 5. Update trade status
   *
   * @param trade - The trade to execute
   * @returns Updated trade with execution status
   */
  private async executeIndividualTrade(trade: Trade): Promise<Trade> {
    logger.info(
      `Executing ${trade.type} trade: ${trade.outcome} - ${trade.amount} shares at $${trade.price.toFixed(4)}`
    );

    try {
      // TODO: Implement actual Polymarket API integration
      // For now, simulate execution

      // Simulate network delay
      await this.sleep(1000);

      // Simulate 95% success rate
      const success = Math.random() > 0.05;

      if (success) {
        // Update trade as executed
        trade.status = TradeStatus.EXECUTED;
        trade.executedAt = new Date();
        trade.txHash = `0x${this.generateMockTxHash()}`;

        logger.info(`Trade executed:  ${trade.id}, TxHash: ${trade.txHash}`);
      } else {
        // Simulate failure
        trade.status = TradeStatus.FAILED;
        trade.error = 'Simulated execution failure';

        logger.error(`Trade failed: ${trade.id} - ${trade.error}`);
      }

      return trade;
    } catch (error) {
      // Handle unexpected errors
      trade.status = TradeStatus.FAILED;
      trade.error = error instanceof Error ? error.message : 'Unknown error';

      logger.error(`Trade execution error: ${trade.id}`, error);
      return trade;
    }
  }

  /**
   * Simulate trade execution (dry-run mode)
   *
   * Used when trading is disabled
   * Logs what would happen without actually trading
   *
   * @param opportunity - The opportunity to simulate
   * @returns Array of simulated trades
   */
  private simulateTrade(opportunity: ArbitrageOpportunity): Trade[] {
    logger.info('========== DRY RUN SIMULATION ==========');
    logger.info(`Would execute ${opportunity.type} arbitrage:`);
    logger.info(`Market: ${opportunity.marketId}`);
    logger.info(`Buy:  ${opportunity.buyOutcome} at $${opportunity.buyPrice.toFixed(4)}`);

    if (opportunity.sellOutcome !== 'N/A') {
      logger.info(`Sell: ${opportunity.sellOutcome} at $${opportunity.sellPrice.toFixed(4)}`);
    }

    logger.info(
      `Expected profit: $${opportunity.expectedProfit.toFixed(4)} (${(opportunity.profitPercentage * 100).toFixed(2)}%)`
    );
    logger.info(`Required capital: $${opportunity.requiredCapital.toFixed(4)}`);
    logger.info(`Risk score: ${opportunity.riskScore.toFixed(2)}`);
    logger.info('========================================');

    // Create mock trades
    const mockTrade: Trade = {
      id: uuidv4(),
      marketId: opportunity.marketId,
      outcome: opportunity.buyOutcome,
      type: TradeType.BUY,
      amount: opportunity.requiredCapital,
      price: opportunity.buyPrice,
      status: TradeStatus.EXECUTED, // Mark as executed in simulation
      createdAt: new Date(),
      executedAt: new Date(),
      profit: opportunity.expectedProfit,
      txHash: `SIMULATED_${uuidv4()}`,
    };

    return [mockTrade];
  }

  /**
   * Cancel a pending trade
   *
   * @param tradeId - ID of trade to cancel
   * @returns true if cancelled, false if not found or already completed
   */
  async cancelTrade(tradeId: string): Promise<boolean> {
    logger.info(`Attempting to cancel trade ${tradeId}`);

    const tradeIndex = this.pendingTrades.findIndex((t) => t.id === tradeId);

    if (tradeIndex === -1) {
      logger.warn(`Trade ${tradeId} not found in pending trades`);
      return false;
    }

    const trade = this.pendingTrades[tradeIndex];

    // TODO: Implement actual order cancellation via API

    // Update status
    trade.status = TradeStatus.CANCELLED;

    // Move from pending to completed
    this.pendingTrades.splice(tradeIndex, 1);
    this.completedTrades.push(trade);

    logger.info(`Trade ${tradeId} cancelled`);
    return true;
  }

  /**
   * Check if a trade should be retried
   *
   * @param trade - The failed trade
   * @returns true if should retry, false otherwise
   */
  private shouldRetry(trade: Trade): boolean {
    const retries = this.retryCount.get(trade.id) || 0;

    if (retries >= this.maxRetries) {
      logger.info(`Trade ${trade.id} exceeded max retries (${this.maxRetries})`);
      return false;
    }

    this.retryCount.set(trade.id, retries + 1);
    return true;
  }

  /**
   * Get all pending trades
   */
  getPendingTrades(): Trade[] {
    return [...this.pendingTrades];
  }

  /**
   * Get all completed trades
   */
  getCompletedTrades(): Trade[] {
    return [...this.completedTrades];
  }

  /**
   * Get trades for a specific market
   */
  getTradesByMarket(marketId: string): Trade[] {
    return [
      ...this.pendingTrades.filter((t) => t.marketId === marketId),
      ...this.completedTrades.filter((t) => t.marketId === marketId),
    ];
  }

  /**
   * Calculate total profit from completed trades
   */
  getTotalProfit(): number {
    return this.completedTrades
      .filter((t) => t.status === TradeStatus.EXECUTED && t.profit)
      .reduce((sum, t) => sum + (t.profit || 0), 0);
  }

  /**
   * Get execution success rate
   */
  getSuccessRate(): number {
    if (this.completedTrades.length === 0) return 0;

    const successCount = this.completedTrades.filter(
      (t) => t.status === TradeStatus.EXECUTED
    ).length;

    return successCount / this.completedTrades.length;
  }

  /**
   * Clear completed trades (for testing/cleanup)
   */
  clearHistory(): void {
    this.completedTrades = [];
    this.retryCount.clear();
    logger.info('Cleared trade history');
  }

  // ========== HELPER METHODS ==========

  /**
   * Sleep utility for delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Generate mock transaction hash
   */
  private generateMockTxHash(): string {
    return Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  }
}

export default TradeExecutor;
