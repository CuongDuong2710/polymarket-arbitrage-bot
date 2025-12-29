import axios, { AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';
import config from '../config/config';
import logger from '../utils/logger';
import { Market, MarketPrice } from '../models/Market';

export interface PolymarketMarketResponse {
  id: string;
  question: string;
  description: string;
  end_date_iso: string;
  outcomes: string[];
  active: boolean;
  closed: boolean;
  volume: string;
  liquidity: string;
  tokens: Array<{
    token_id: string;
    outcome: string;
    price: string;
    winner: boolean;
  }>;
}

export interface OrderBookResponse {
  asset_id: string;
  bids: Array<{ price: string; size: string }>;
  asks: Array<{ price: string; size: string }>;
  timestamp: number;
}

export class PolymarketAPI {
  private axiosInstance: AxiosInstance;
  private readonly baseURL: string;

  constructor() {
    this.baseURL = config.polymarket.apiUrl;

    // Create axios instance with default config
    this.axiosInstance = axios.create({
      baseURL: this.baseURL,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Configure retry logic
    axiosRetry(this.axiosInstance, {
      retries: 3,
      retryDelay: axiosRetry.exponentialDelay,
      retryCondition: (error) => {
        return (
          axiosRetry.isNetworkOrIdempotentRequestError(error) || error.response?.status === 429
        );
      },
      onRetry: (retryCount, error) => {
        logger.warn(`Retrying request (attempt ${retryCount}): ${error.message}`);
      },
    });

    logger.info('PolymarketAPI initialized');
  }

  /**
   * Fetch all active markets
   */
  async getMarkets(limit: number = 100, offset: number = 0): Promise<Market[]> {
    try {
      logger.debug(`Fetching markets (limit: ${limit}, offset:  ${offset})`);

      const response = await this.axiosInstance.get<PolymarketMarketResponse[]>('/markets', {
        params: {
          limit,
          offset,
          active: true,
        },
      });

      const markets = response.data.map(this.transformMarket);
      logger.info(`Fetched ${markets.length} markets`);

      return markets;
    } catch (error) {
      logger.error('Error fetching markets', error);
      throw error;
    }
  }

  /**
   * Fetch a specific market by ID
   */
  async getMarket(marketId: string): Promise<Market> {
    try {
      logger.debug(`Fetching market: ${marketId}`);

      const response = await this.axiosInstance.get<PolymarketMarketResponse>(
        `/markets/${marketId}`
      );

      return this.transformMarket(response.data);
    } catch (error) {
      logger.error(`Error fetching market ${marketId}`, error);
      throw error;
    }
  }

  /**
   * Fetch order book for a specific token/outcome
   */
  async getOrderBook(tokenId: string): Promise<OrderBookResponse> {
    try {
      logger.debug(`Fetching order book for token: ${tokenId}`);

      const response = await this.axiosInstance.get<OrderBookResponse>(`/order-book/${tokenId}`);

      return response.data;
    } catch (error) {
      logger.error(`Error fetching order book for ${tokenId}`, error);
      throw error;
    }
  }

  /**
   * Fetch prices for all outcomes in a market
   */
  async getMarketPrices(marketId: string): Promise<MarketPrice[]> {
    try {
      logger.debug(`Fetching prices for market: ${marketId}`);

      const market = await this.getMarket(marketId);
      const prices: MarketPrice[] = [];

      for (const token of (market as any).tokens || []) {
        const orderBook = await this.getOrderBook(token.token_id);

        const bidPrice = orderBook.bids.length > 0 ? parseFloat(orderBook.bids[0].price) : 0;
        const askPrice = orderBook.asks.length > 0 ? parseFloat(orderBook.asks[0].price) : 0;
        const lastPrice = parseFloat(token.price) || 0;

        prices.push({
          marketId,
          outcome: token.outcome,
          bidPrice,
          askPrice,
          lastPrice,
          timestamp: new Date(orderBook.timestamp * 1000),
        });
      }

      logger.debug(`Fetched ${prices.length} prices for market ${marketId}`);
      return prices;
    } catch (error) {
      logger.error(`Error fetching prices for market ${marketId}`, error);
      throw error;
    }
  }

  /**
   * Get trending markets
   */
  async getTrendingMarkets(limit: number = 20): Promise<Market[]> {
    try {
      logger.debug(`Fetching trending markets (limit:  ${limit})`);

      const response = await this.axiosInstance.get<PolymarketMarketResponse[]>('/markets', {
        params: {
          limit,
          active: true,
          order: 'volume',
        },
      });

      return response.data.map(this.transformMarket);
    } catch (error) {
      logger.error('Error fetching trending markets', error);
      throw error;
    }
  }

  /**
   * Transform API response to internal Market model
   */
  private transformMarket(data: PolymarketMarketResponse): Market {
    return {
      id: data.id,
      question: data.question,
      description: data.description,
      endDate: new Date(data.end_date_iso),
      outcomes: data.outcomes,
      active: data.active && !data.closed,
      volume: parseFloat(data.volume) || 0,
      liquidity: parseFloat(data.liquidity) || 0,
    };
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.axiosInstance.get('/health');
      return true;
    } catch (error) {
      logger.error('Polymarket API health check failed', error);
      return false;
    }
  }
}

export default PolymarketAPI;
