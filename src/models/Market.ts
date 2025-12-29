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

export interface ArbitrageOpportunity {
  marketId: string;
  buyOutcome: string;
  sellOutcome: string;
  buyPrice: number;
  sellPrice: number;
  expectedProfit: number;
  profitPercentage: number;
  confidence: number;
  timestamp: Date;
}