# Polymarket Arbitrage Bot

An automated arbitrage trading bot for Polymarket built with TypeScript and Node.js.

## Features

- 🔍 Monitor multiple Polymarket markets for price discrepancies
- ⚡ Execute arbitrage trades automatically
- 🛡️ Risk management and position sizing
- 📊 Profit tracking and reporting
- ⚙️ Configurable thresholds and parameters
- 📝 Comprehensive logging and notifications
- 🎨 UI dashboard (coming soon)

## Prerequisites

- Node.js >= 16.0.0
- npm >= 8.0.0
- A Polygon wallet with USDC for trading
- Polymarket API access

## Installation

1. Clone the repository: 
```bash
git clone https://github.com/CuongDuong2710/polymarket-arbitrage-bot.git
cd polymarket-arbitrage-bot
```

2. Install dependencies:
```bash
npm install
```

3. Create environment file:
```bash
cp .env.example .env
```

4. Configure your `.env` file with your settings:
   - Add your wallet private key (KEEP THIS SECURE!)
   - Set trading parameters
   - Configure notification webhooks (optional)

## Usage

### Development Mode

Run the bot in development mode with hot reload: 

```bash
npm run dev
```

### Production Mode

Build and run in production:

```bash
npm run build
npm start
```

### Linting and Formatting

```bash
# Run linter
npm run lint

# Fix linting issues
npm run lint: fix

# Format code
npm run format
```

## Project Structure

```
polymarket-arbitrage-bot/
├── src/
│   ├── config/          # Configuration files
│   ├── services/        # Business logic services
│   ├── models/          # Data models and types
│   ├── utils/           # Utility functions
│   ├── api/             # API integrations
│   ├── controllers/     # Route controllers
│   └── index.ts         # Application entry point
├── tests/               # Test files
├── data/                # Database and data storage
├── logs/                # Log files
├── ui/                  # Frontend dashboard
├── dist/                # Compiled JavaScript (generated)
└── node_modules/        # Dependencies (generated)
```

## API Endpoints

- `GET /health` - Health check
- `GET /api/markets` - Get monitored markets
- `GET /api/positions` - Get current positions
- `GET /api/trades/pending` - Get pending trades

## Configuration

Key configuration options in `.env`:

| Variable | Description | Default |
|----------|-------------|---------|
| `MIN_PROFIT_THRESHOLD` | Minimum profit percentage to execute trade | 0.02 (2%) |
| `MAX_POSITION_SIZE` | Maximum size per position | 100 |
| `MAX_TOTAL_EXPOSURE` | Maximum total exposure across all positions | 1000 |
| `TRADING_ENABLED` | Enable/disable actual trading | false |
| `POLL_INTERVAL_MS` | Market polling interval | 5000 (5s) |

## Safety Features

- **Dry run mode**: Test without real trades (TRADING_ENABLED=false)
- **Position limits**: Prevent overexposure
- **Profit thresholds**: Only execute profitable trades
- **Risk management**:  Automatic stop-loss and slippage protection

## Development Roadmap

See [Issue #1](https://github.com/CuongDuong2710/polymarket-arbitrage-bot/issues/1) for the complete project plan.

- [x] Initial project setup
- [ ] Polymarket API integration
- [ ] Market monitoring service
- [ ] Arbitrage detection engine
- [ ] Trade execution module
- [ ] Risk management system
- [ ] Profit tracking and reporting
- [ ] Logging and notifications
- [ ] UI dashboard
- [ ] Testing and deployment

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT

## Disclaimer

This bot is for educational purposes.  Trading cryptocurrencies involves risk.  Always test thoroughly before using real funds.  The authors are not responsible for any financial losses. 

## Support

For issues and questions, please open an issue on GitHub.