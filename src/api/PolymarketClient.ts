import { ClobClient } from '@polymarket/clob-client';
import { ethers } from 'ethers';
import config from '../config/config';
import logger from '../utils/logger';

export class PolymarketClient {
  private client: ClobClient | null = null;
  private wallet: ethers.Wallet | null = null;
  private provider: ethers.providers.Provider;
  private isInitialized: boolean = false;

  constructor() {
    // Initialize provider for Polygon network
    this.provider = new ethers.providers.JsonRpcProvider(
      config.polymarket.rpcUrl || 'https://polygon-rpc.com'
    );
  }

  async initialize(): Promise<void> {
    try {
      if (this.isInitialized) {
        logger.warn('PolymarketClient already initialized');
        return;
      }

      // Initialize wallet
      if (config.wallet.privateKey) {
        this.wallet = new ethers.Wallet(config.wallet.privateKey, this.provider);
        logger.info(`Wallet initialized:  ${this.wallet.address}`);
      } else {
        logger.warn('No private key provided. Running in read-only mode.');
      }

      // Initialize CLOB client
      this.client = new ClobClient(
        config.polymarket.apiUrl,
        config.polymarket.chainId,
        this.wallet || undefined
      );

      this.isInitialized = true;
      logger.info('PolymarketClient initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize PolymarketClient', error);
      throw error;
    }
  }

  getClient(): ClobClient {
    if (!this.client) {
      throw new Error('PolymarketClient not initialized.  Call initialize() first.');
    }
    return this.client;
  }

  getWallet(): ethers.Wallet {
    if (!this.wallet) {
      throw new Error('Wallet not initialized.  Provide PRIVATE_KEY in environment.');
    }
    return this.wallet;
  }

  getProvider(): ethers.providers.Provider {
    return this.provider;
  }

  isReady(): boolean {
    return this.isInitialized && this.client !== null;
  }
}

export default PolymarketClient;
