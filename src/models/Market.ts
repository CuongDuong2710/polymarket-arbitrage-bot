export interface Market {
  id: string;
  question: string;
  description: string;
  endDate: Date;
  outcomes: string[];
  active: boolean;
  volume: number;
  liquidity: number;
}

export interface MarketPrice {
  marketId: string;
  outcome: string;
  bidPrice: number;
  askPrice: number;
  lastPrice: number;
  timestamp: Date;
}

/**
 * Represents a detected arbitrage opportunity
 *
 * Arbitrage is when you can guarantee profit by exploiting price differences
 * Example: If "Yes" + "No" costs less than $1.00, you can buy both and profit
 */
export interface ArbitrageOpportunity {
  id: string; // Unique identifier for this opportunity
  marketId: string; // Which market this opportunity is in
  type: ArbitrageType; // What kind of arbitrage (see below)
  buyOutcome: string; // Which outcome to buy
  sellOutcome: string; // Which outcome to sell (if applicable)
  buyPrice: number; // Price to buy at (ask price)
  sellPrice: number; // Price to sell at (bid price, if applicable)
  expectedProfit: number; // Profit in USDC if executed
  profitPercentage: number; // Profit as a percentage (e.g., 0.05 = 5%)
  confidence: number; // How confident we are (0-1, based on liquidity/spread)
  timestamp: Date; // When this opportunity was detected
  expiresAt?: Date; // When this opportunity likely expires
  requiredCapital: number; // How much USDC needed to execute
  estimatedSlippage: number; // Expected price slippage
  riskScore: number; // Risk assessment (0-1, lower is safer)
}

/**
 * Types of arbitrage strategies
 */
export enum ArbitrageType {
  /**
   * COMPLEMENTARY:  Buy all outcomes when total cost < $1.00
   * Example: "Yes" costs $0.48, "No" costs $0.49 = $0.97 total
   * Since one MUST happen, you're guaranteed $1.00, profit = $0.03
   */
  COMPLEMENTARY = 'COMPLEMENTARY',

  /**
   * CROSS_MARKET: Same event priced differently on different markets
   * Example: Market A has "Yes" at $0.50, Market B has "Yes" at $0.55
   * Buy on A, sell on B, profit = $0.05
   */
  CROSS_MARKET = 'CROSS_MARKET',

  /**
   * MISPRICING: When bid > ask (shouldn't happen but sometimes does)
   * Example: Someone willing to buy at $0.52 but sell at $0.50
   * Buy at $0.50, immediately sell at $0.52, profit = $0.02
   */
  MISPRICING = 'MISPRICING',

  /**
   * TEMPORAL:  Price discrepancy that will correct over time
   * Example: Price spike creates temporary imbalance
   * Riskier - relies on price returning to normal
   */
  TEMPORAL = 'TEMPORAL',
}
