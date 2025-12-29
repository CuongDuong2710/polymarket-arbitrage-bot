export enum TradeStatus {
  PENDING = 'PENDING',
  EXECUTED = 'EXECUTED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export enum TradeType {
  BUY = 'BUY',
  SELL = 'SELL',
}

export interface Trade {
  id: string;
  marketId: string;
  outcome: string;
  type: TradeType;
  amount: number;
  price: number;
  status: TradeStatus;
  txHash?: string;
  createdAt: Date;
  executedAt?: Date;
  profit?: number;
  error?: string;
}

export interface Position {
  marketId: string;
  outcome: string;
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  realizedPnL: number;
}
