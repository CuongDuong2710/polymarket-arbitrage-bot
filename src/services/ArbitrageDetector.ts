import { v4 as uuidv4 } from 'uuid';
import { ArbitrageOpportunity, MarketPrice, ArbitrageType } from '../models/Market';
import config from '../config/config';
import logger from '../utils/logger';

/**
 * ArbitrageDetector finds profitable trading opportunities
 *
 * How it works:
 * 1. Analyzes price data from markets
 * 2. Applies multiple detection strategies
 * 3. Scores and ranks opportunities
 * 4. Filters based on profitability and risk thresholds
 *
 * Detection Strategies:
 * - Complementary: When buying all outcomes costs < $1.00
 * - Mispricing: When bid > ask price
 * - Cross-market: Same event priced differently (future feature)
 */
export class ArbitrageDetector {
  // Minimum profit threshold (from config, e.g., 2%)
  private readonly minProfitThreshold: number;

  // Maximum acceptable slippage (from config, e.g., 1%)
  private readonly maxSlippage: number;

  // Minimum confidence score to consider opportunity valid
  private readonly minConfidence: number = 0.6;

  // Track recently detected opportunities (prevents duplicates)
  private recentOpportunities: Map<string, ArbitrageOpportunity> = new Map();

  // How long to remember opportunities (prevents re-detecting same one)
  private readonly opportunityTTL: number = 60000; // 60 seconds

  constructor() {
    this.minProfitThreshold = config.trading.minProfitThreshold;
    this.maxSlippage = config.risk.maxSlippage;

    logger.info('ArbitrageDetector initialized');
    logger.info(`Min profit threshold: ${(this.minProfitThreshold * 100).toFixed(2)}%`);
    logger.info(`Max slippage: ${(this.maxSlippage * 100).toFixed(2)}%`);
  }

  /**
   * Main detection method - analyzes prices and finds opportunities
   *
   * @param prices - Current prices for a market
   * @returns Array of detected opportunities (sorted by profitability)
   */
  detectOpportunities(prices: MarketPrice[]): ArbitrageOpportunity[] {
    // Guard:  need at least one price to analyze
    if (prices.length === 0) {
      return [];
    }

    const opportunities: ArbitrageOpportunity[] = [];
    const marketId = prices[0].marketId;

    // ========== STRATEGY 1: COMPLEMENTARY ARBITRAGE ==========
    // Check if buying all outcomes costs less than $1.00
    const complementary = this.detectComplementaryArbitrage(marketId, prices);
    if (complementary) {
      opportunities.push(complementary);
    }

    // ========== STRATEGY 2: MISPRICING DETECTION ==========
    // Check if any bid prices exceed ask prices
    const mispricings = this.detectMispricing(marketId, prices);
    opportunities.push(...mispricings);

    // ========== STRATEGY 3: TEMPORAL ARBITRAGE ==========
    // Check for temporary price imbalances
    const temporal = this.detectTemporalArbitrage(marketId, prices);
    opportunities.push(...temporal);

    // ========== FILTER AND RANK ==========
    // Only keep opportunities that pass our filters
    const validOpportunities = opportunities.filter((opp) => {
      // Must meet minimum profit threshold
      if (opp.profitPercentage < this.minProfitThreshold) {
        logger.debug(
          `Opportunity rejected: profit ${(opp.profitPercentage * 100).toFixed(2)}% below threshold`
        );
        return false;
      }

      // Must meet minimum confidence
      if (opp.confidence < this.minConfidence) {
        logger.debug(`Opportunity rejected: confidence ${opp.confidence} too low`);
        return false;
      }

      // Must not have excessive slippage
      if (opp.estimatedSlippage > this.maxSlippage) {
        logger.debug(
          `Opportunity rejected: slippage ${(opp.estimatedSlippage * 100).toFixed(2)}% too high`
        );
        return false;
      }

      // Must not be a duplicate we recently detected
      if (this.isDuplicate(opp)) {
        logger.debug(`Opportunity rejected: duplicate`);
        return false;
      }

      return true;
    });

    // Sort by profit percentage (highest first)
    validOpportunities.sort((a, b) => b.profitPercentage - a.profitPercentage);

    // Remember these opportunities
    validOpportunities.forEach((opp) => {
      this.recentOpportunities.set(opp.id, opp);
    });

    // Clean up old opportunities
    this.cleanupOldOpportunities();

    if (validOpportunities.length > 0) {
      logger.info(
        `Detected ${validOpportunities.length} valid arbitrage opportunities in market ${marketId}`
      );
    }

    return validOpportunities;
  }

  /**
   * STRATEGY 1: Complementary Arbitrage
   *
   * Detects when buying ALL outcomes costs less than $1.00
   *
   * Example:
   * - Market:  "Will it rain tomorrow?"
   * - "Yes" ask price: $0.47
   * - "No" ask price: $0.51
   * - Total cost: $0.98
   * - Guaranteed payout: $1.00
   * - Profit: $0.02 (2%)
   *
   * This is TRUE arbitrage - zero risk, guaranteed profit
   *
   * @param marketId - The market to analyze
   * @param prices - All outcome prices
   * @returns Opportunity if found, null otherwise
   */
  private detectComplementaryArbitrage(
    marketId: string,
    prices: MarketPrice[]
  ): ArbitrageOpportunity | null {
    // For binary markets (Yes/No), check if total cost < 1.00
    if (prices.length === 2) {
      // Calculate total cost to buy both outcomes
      // Use ASK prices because we're buying
      const totalCost = prices.reduce((sum, p) => sum + p.askPrice, 0);

      // If total cost < $1.00, we have arbitrage!
      if (totalCost < 1.0) {
        const profit = 1.0 - totalCost;
        const profitPercentage = profit / totalCost;

        // Calculate confidence based on liquidity indicators
        const avgSpread =
          prices.reduce((sum, p) => sum + (p.askPrice - p.bidPrice), 0) / prices.length;
        const confidence = this.calculateConfidence(avgSpread, prices);

        // Estimate slippage based on spread
        const estimatedSlippage = avgSpread / 2; // Rough estimate

        // Calculate risk score (lower is better)
        const riskScore = this.calculateRiskScore(totalCost, avgSpread, prices);

        const opportunity: ArbitrageOpportunity = {
          id: uuidv4(),
          marketId,
          type: ArbitrageType.COMPLEMENTARY,
          buyOutcome: prices.map((p) => p.outcome).join(' + '),
          sellOutcome: 'N/A',
          buyPrice: totalCost,
          sellPrice: 1.0,
          expectedProfit: profit,
          profitPercentage,
          confidence,
          timestamp: new Date(),
          expiresAt: new Date(Date.now() + 30000), // Expires in 30 seconds
          requiredCapital: totalCost,
          estimatedSlippage,
          riskScore,
        };

        logger.info(
          `🎯 Complementary arbitrage found: Buy [${prices.map((p) => p.outcome).join(' + ')}] ` +
            `for $${totalCost.toFixed(4)}, profit:  $${profit.toFixed(4)} (${(profitPercentage * 100).toFixed(2)}%)`
        );

        return opportunity;
      }
    }

    // For multi-outcome markets (e.g., 3+ outcomes)
    if (prices.length > 2) {
      const totalCost = prices.reduce((sum, p) => sum + p.askPrice, 0);

      // In multi-outcome markets, exactly one outcome wins
      // So total implied probability should be 100%
      if (totalCost < 1.0) {
        const profit = 1.0 - totalCost;
        const profitPercentage = profit / totalCost;

        const avgSpread =
          prices.reduce((sum, p) => sum + (p.askPrice - p.bidPrice), 0) / prices.length;
        const confidence = this.calculateConfidence(avgSpread, prices);
        const estimatedSlippage = avgSpread / 2;
        const riskScore = this.calculateRiskScore(totalCost, avgSpread, prices);

        const opportunity: ArbitrageOpportunity = {
          id: uuidv4(),
          marketId,
          type: ArbitrageType.COMPLEMENTARY,
          buyOutcome: `All ${prices.length} outcomes`,
          sellOutcome: 'N/A',
          buyPrice: totalCost,
          sellPrice: 1.0,
          expectedProfit: profit,
          profitPercentage,
          confidence,
          timestamp: new Date(),
          expiresAt: new Date(Date.now() + 30000),
          requiredCapital: totalCost,
          estimatedSlippage,
          riskScore,
        };

        logger.info(
          `🎯 Multi-outcome complementary arbitrage found: ` +
            `Buy all ${prices.length} outcomes for $${totalCost.toFixed(4)}, ` +
            `profit: $${profit.toFixed(4)} (${(profitPercentage * 100).toFixed(2)}%)`
        );

        return opportunity;
      }
    }

    return null;
  }

  /**
   * STRATEGY 2: Mispricing Detection
   *
   * Detects when bid price > ask price (shouldn't happen but sometimes does)
   *
   * Example:
   * - Someone offers to BUY at $0.52 (bid)
   * - Someone offers to SELL at $0.50 (ask)
   * - Buy at $0.50, immediately sell at $0.52
   * - Instant profit: $0.02
   *
   * This is extremely rare but can happen due to:
   * - API latency
   * - Market inefficiency
   * - Bot errors from other traders
   *
   * @param marketId - The market to analyze
   * @param prices - All outcome prices
   * @returns Array of mispricing opportunities
   */
  private detectMispricing(marketId: string, prices: MarketPrice[]): ArbitrageOpportunity[] {
    const opportunities: ArbitrageOpportunity[] = [];

    for (const price of prices) {
      // Check if bid > ask (price inversion)
      if (price.bidPrice > price.askPrice) {
        const profit = price.bidPrice - price.askPrice;
        const profitPercentage = profit / price.askPrice;

        // High confidence - this is clear mispricing
        const confidence = 0.9;

        // Low slippage expected - direct buy/sell
        const estimatedSlippage = 0.001; // 0.1%

        // Low risk - immediate execution
        const riskScore = 0.1;

        const opportunity: ArbitrageOpportunity = {
          id: uuidv4(),
          marketId,
          type: ArbitrageType.MISPRICING,
          buyOutcome: price.outcome,
          sellOutcome: price.outcome,
          buyPrice: price.askPrice,
          sellPrice: price.bidPrice,
          expectedProfit: profit,
          profitPercentage,
          confidence,
          timestamp: new Date(),
          expiresAt: new Date(Date.now() + 10000), // Very short - 10 seconds
          requiredCapital: price.askPrice,
          estimatedSlippage,
          riskScore,
        };

        logger.warn(
          `🚨 MISPRICING DETECTED: ${price.outcome} - ` +
            `Bid: $${price.bidPrice.toFixed(4)} > Ask: $${price.askPrice.toFixed(4)}, ` +
            `profit: $${profit.toFixed(4)} (${(profitPercentage * 100).toFixed(2)}%)`
        );

        opportunities.push(opportunity);
      }
    }

    return opportunities;
  }

  /**
   * STRATEGY 3: Temporal Arbitrage
   *
   * Detects temporary price imbalances that should correct
   *
   * Example:
   * - Binary market: "Yes" = $0.70, "No" = $0.35
   * - Total = $1.05 (over 100%)
   * - This means market is temporarily inefficient
   * - We could sell both outcomes and buy them back later
   *
   * NOTE: This is RISKIER than complementary arbitrage
   * - Relies on market correcting itself
   * - Could lose money if market moves against us
   * - Only use with good risk management
   *
   * @param marketId - The market to analyze
   * @param prices - All outcome prices
   * @returns Array of temporal opportunities
   */
  private detectTemporalArbitrage(marketId: string, prices: MarketPrice[]): ArbitrageOpportunity[] {
    const opportunities: ArbitrageOpportunity[] = [];

    // Only works for binary markets
    if (prices.length === 2) {
      // Calculate total using BID prices (we'd be selling)
      const totalBidPrice = prices.reduce((sum, p) => sum + p.bidPrice, 0);

      // If total > 1.0, we can sell both and profit from inefficiency
      if (totalBidPrice > 1.0) {
        const profit = totalBidPrice - 1.0;
        const profitPercentage = profit / 1.0;

        // Lower confidence - relies on market correction
        const avgSpread =
          prices.reduce((sum, p) => sum + (p.askPrice - p.bidPrice), 0) / prices.length;
        const confidence = Math.max(0.3, this.calculateConfidence(avgSpread, prices) * 0.6);

        // Higher slippage risk
        const estimatedSlippage = avgSpread * 1.5;

        // Higher risk - not guaranteed profit
        const riskScore = 0.7;

        const opportunity: ArbitrageOpportunity = {
          id: uuidv4(),
          marketId,
          type: ArbitrageType.TEMPORAL,
          buyOutcome: 'N/A',
          sellOutcome: prices.map((p) => p.outcome).join(' + '),
          buyPrice: 1.0,
          sellPrice: totalBidPrice,
          expectedProfit: profit,
          profitPercentage,
          confidence,
          timestamp: new Date(),
          expiresAt: new Date(Date.now() + 60000), // 60 seconds
          requiredCapital: 1.0,
          estimatedSlippage,
          riskScore,
        };

        logger.info(
          `⏰ Temporal arbitrage found:  Sell [${prices.map((p) => p.outcome).join(' + ')}] ` +
            `for $${totalBidPrice.toFixed(4)}, profit: $${profit.toFixed(4)} (${(profitPercentage * 100).toFixed(2)}%)`
        );

        opportunities.push(opportunity);
      }
    }

    return opportunities;
  }

  /**
   * Calculate confidence score based on market conditions
   *
   * Factors:
   * - Tight spread = higher confidence (more liquidity)
   * - Wide spread = lower confidence (less liquidity, more slippage)
   *
   * @param avgSpread - Average bid-ask spread
   * @param prices - Price data
   * @returns Confidence score (0-1)
   */
  private calculateConfidence(avgSpread: number, prices: MarketPrice[]): number {
    // Lower spread = higher confidence
    // Spread of 0.01 (1%) = high confidence (0.95)
    // Spread of 0.10 (10%) = low confidence (0.50)
    const spreadFactor = Math.max(0.5, 1 - avgSpread * 5);

    // More outcomes = slightly lower confidence (complexity)
    const outcomesFactor = Math.max(0.8, 1 - (prices.length - 2) * 0.1);

    return Math.min(1.0, spreadFactor * outcomesFactor);
  }

  /**
   * Calculate risk score for an opportunity
   *
   * Factors:
   * - Required capital (higher = more risk)
   * - Spread (wider = more risk)
   * - Price volatility
   *
   * @returns Risk score (0-1, lower is safer)
   */
  private calculateRiskScore(
    requiredCapital: number,
    avgSpread: number,
    prices: MarketPrice[]
  ): number {
    // Capital risk:  more capital = more risk
    const capitalRisk = Math.min(1.0, requiredCapital / config.trading.maxPositionSize);

    // Spread risk: wider spread = more slippage risk
    const spreadRisk = Math.min(1.0, avgSpread * 10);

    // Combine factors
    const overallRisk = (capitalRisk + spreadRisk) / 2;

    return Math.max(0, Math.min(1.0, overallRisk));
  }

  /**
   * Check if this opportunity was recently detected
   * Prevents duplicate detection and execution
   *
   * @param opportunity - Opportunity to check
   * @returns true if duplicate, false if new
   */
  private isDuplicate(opportunity: ArbitrageOpportunity): boolean {
    // Check recent opportunities
    for (const recent of this.recentOpportunities.values()) {
      // Same market, type, and similar profit = duplicate
      if (
        recent.marketId === opportunity.marketId &&
        recent.type === opportunity.type &&
        Math.abs(recent.profitPercentage - opportunity.profitPercentage) < 0.001 // Within 0.1%
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Clean up old opportunities from memory
   * Removes opportunities older than TTL
   */
  private cleanupOldOpportunities(): void {
    const now = Date.now();

    for (const [id, opp] of this.recentOpportunities.entries()) {
      const age = now - opp.timestamp.getTime();

      if (age > this.opportunityTTL) {
        this.recentOpportunities.delete(id);
      }
    }
  }

  /**
   * Check if an opportunity is still profitable
   * Useful before executing to ensure it's still valid
   *
   * @param opportunity - Opportunity to validate
   * @returns true if still profitable, false otherwise
   */
  isProfitable(opportunity: ArbitrageOpportunity): boolean {
    return opportunity.profitPercentage >= this.minProfitThreshold;
  }

  /**
   * Calculate expected profit for buying/selling at specific prices
   *
   * @param buyPrice - Price to buy at
   * @param sellPrice - Price to sell at
   * @param amount - Amount to trade
   * @returns Expected profit in USDC
   */
  calculateExpectedProfit(buyPrice: number, sellPrice: number, amount: number): number {
    // TODO: Include fees and slippage in calculation
    // For now, simple calculation
    const grossProfit = (sellPrice - buyPrice) * amount;

    // Estimate trading fees (0.2% per side = 0.4% total)
    const fees = (buyPrice + sellPrice) * amount * 0.002;

    return grossProfit - fees;
  }

  /**
   * Get all recently detected opportunities
   * Useful for dashboards and monitoring
   */
  getRecentOpportunities(): ArbitrageOpportunity[] {
    return Array.from(this.recentOpportunities.values());
  }

  /**
   * Clear all cached opportunities
   * Useful for testing or resetting state
   */
  clearCache(): void {
    this.recentOpportunities.clear();
    logger.info('Cleared arbitrage detector cache');
  }
}

export default ArbitrageDetector;
