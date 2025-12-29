import { Position } from '../models/Trade';
import { ArbitrageOpportunity } from '../models/Market';
import config from '../config/config';
import logger from '../utils/logger';

export class RiskManager {
  private positions: Map<string, Position> = new Map();
  private totalExposure: number = 0;

  constructor() {
    logger.info('RiskManager initialized');
  }

  canExecuteTrade(opportunity: ArbitrageOpportunity, amount: number): boolean {
    // Check if amount exceeds max position size
    if (amount > config.trading.maxPositionSize) {
      logger.warn(`Trade amount ${amount} exceeds max position size`);
      return false;
    }

    // Check if total exposure would exceed limit
    if (this.totalExposure + amount > config.trading.maxTotalExposure) {
      logger.warn(`Trade would exceed max total exposure`);
      return false;
    }

    // Check profit threshold
    if (opportunity.profitPercentage < config.trading.minProfitThreshold) {
      logger.warn(`Profit ${opportunity.profitPercentage} below threshold`);
      return false;
    }

    return true;
  }

  calculatePositionSize(opportunity: ArbitrageOpportunity): number {
    // TODO: Implement sophisticated position sizing logic
    // Consider Kelly Criterion, risk-adjusted returns, etc.
    return Math.min(config.trading.maxPositionSize, 10);
  }

  updatePosition(marketId: string, outcome: string, quantity: number, price: number): void {
    const key = `${marketId}-${outcome}`;
    const existing = this.positions.get(key);

    if (existing) {
      const totalQuantity = existing.quantity + quantity;
      const averagePrice =
        (existing.averagePrice * existing.quantity + price * quantity) / totalQuantity;

      existing.quantity = totalQuantity;
      existing.averagePrice = averagePrice;
    } else {
      this.positions.set(key, {
        marketId,
        outcome,
        quantity,
        averagePrice: price,
        currentPrice:  price,
        unrealizedPnL: 0,
        realizedPnL: 0,
      });
    }

    this.updateTotalExposure();
  }

  private updateTotalExposure(): void {
    this.totalExposure = Array.from(this.positions.values()).reduce(
      (sum, pos) => sum + pos.quantity * pos.averagePrice,
      0
    );
  }

  getPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  getTotalExposure(): number {
    return this.totalExposure;
  }
}

export default RiskManager;