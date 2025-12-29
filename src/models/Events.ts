import { Market, MarketPrice, ArbitrageOpportunity } from './Market';

/**
 * Enum defining all possible monitoring event types
 * These events are emitted by the MarketMonitor to notify other parts of the application
 */
export enum MonitoringEventType {
  // Market lifecycle events
  MARKET_ADDED = 'market: added', // When a new market is discovered
  MARKET_UPDATED = 'market:updated', // When market details change
  MARKET_REMOVED = 'market:removed', // When a market is no longer active

  // Price events
  PRICE_UPDATED = 'price:updated', // When prices are refreshed (happens frequently)
  PRICE_SPIKE = 'price:spike', // When price changes dramatically (e.g., >5%)

  // Trading events
  OPPORTUNITY_DETECTED = 'opportunity:detected', // When arbitrage opportunity found

  // System events
  MONITORING_ERROR = 'monitoring:error', // When an error occurs
  MONITORING_STARTED = 'monitoring: started', // When monitoring begins
  MONITORING_STOPPED = 'monitoring: stopped', // When monitoring stops
}

/**
 * Event emitted when a market is added, updated, or removed
 * Contains the market data and timestamp
 */
export interface MarketEvent {
  type: MonitoringEventType;
  market: Market; // The market that triggered this event
  timestamp: Date; // When this event occurred
}

/**
 * Event emitted when prices are updated for a market
 * Includes both current and previous prices for comparison
 */
export interface PriceUpdateEvent {
  type: MonitoringEventType;
  marketId: string; // Which market's prices were updated
  prices: MarketPrice[]; // Current prices for all outcomes
  previousPrices?: MarketPrice[]; // Previous prices (undefined on first update)
  timestamp: Date; // When the update occurred
}

/**
 * Event emitted when a price changes dramatically
 * Example: If "Yes" outcome goes from $0.50 to $0.60 in one update
 */
export interface PriceSpikeEvent {
  type: MonitoringEventType;
  marketId: string; // Which market had the spike
  outcome: string; // Which outcome (e.g., "Yes", "No")
  oldPrice: number; // Price before the spike (e.g., 0.50)
  newPrice: number; // Price after the spike (e.g., 0.60)
  change: number; // Absolute change (e.g., 0.10)
  changePercentage: number; // Percentage change (e.g., 0.20 = 20%)
  timestamp: Date; // When the spike occurred
}

/**
 * Event emitted when an arbitrage opportunity is detected
 * This is a profitable trading opportunity
 */
export interface OpportunityEvent {
  type: MonitoringEventType;
  opportunity: ArbitrageOpportunity; // Details of the profitable opportunity
  timestamp: Date; // When it was detected
}

/**
 * Event emitted when an error occurs during monitoring
 * Helps with debugging and error tracking
 */
export interface MonitoringErrorEvent {
  type: MonitoringEventType;
  error: Error; // The actual error object
  context?: string; // Where the error occurred (e.g., "fetchMarkets")
  timestamp: Date; // When the error happened
}

/**
 * Union type of all possible monitoring events
 * This allows TypeScript to type-check event handlers properly
 */
export type MonitoringEvent =
  | MarketEvent
  | PriceUpdateEvent
  | PriceSpikeEvent
  | OpportunityEvent
  | MonitoringErrorEvent;
