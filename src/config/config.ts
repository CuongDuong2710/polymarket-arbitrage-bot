import dotenv from 'dotenv';

dotenv.config();

export const config = {
  polymarket: {
    apiUrl: process.env.POLYMARKET_API_URL || 'https://clob.polymarket.com',
    chainId: parseInt(process.env.POLYMARKET_CHAIN_ID || '137'),
  },
  wallet: {
    privateKey: process.env.PRIVATE_KEY || '',
    address: process.env.WALLET_ADDRESS || '',
  },
  trading: {
    minProfitThreshold: parseFloat(process.env.MIN_PROFIT_THRESHOLD || '0.02'),
    maxPositionSize: parseFloat(process.env.MAX_POSITION_SIZE || '100'),
    maxTotalExposure: parseFloat(process.env.MAX_TOTAL_EXPOSURE || '1000'),
    enabled: process.env.TRADING_ENABLED === 'true',
  },
  risk: {
    stopLossPercentage: parseFloat(process.env.STOP_LOSS_PERCENTAGE || '0.05'),
    maxSlippage: parseFloat(process.env.MAX_SLIPPAGE || '0.01'),
  },
  monitoring: {
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '5000'),
    logLevel: process.env.LOG_LEVEL || 'info',
  },
  notifications: {
    discordWebhook: process.env.DISCORD_WEBHOOK_URL || '',
    slackWebhook: process.env.SLACK_WEBHOOK_URL || '',
  },
  database: {
    path: process.env.DATABASE_PATH || './data/trades.db',
  },
  server: {
    port: parseInt(process.env.PORT || '3000'),
    nodeEnv: process.env.NODE_ENV || 'development',
  },
};

export default config;
