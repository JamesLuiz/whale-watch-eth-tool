# Whale Tracker Backend

A NestJS backend service for monitoring whale transactions and token purchases on the Ethereum blockchain.

## Features

- **Real-time Whale Monitoring**: Track large ETH transactions (>100 ETH) in real-time
- **Token Analysis**: Identify and analyze token transfers and purchases by whales
- **WebSocket Support**: Real-time updates via WebSocket connections
- **RESTful API**: Comprehensive REST API for whale data and analytics
- **Token Intelligence**: Track trending tokens among whale addresses
- **Address Tracking**: Monitor specific whale addresses and their activities

## Architecture

```
backend/
├── src/
│   ├── modules/
│   │   ├── whale/          # Whale monitoring and tracking
│   │   ├── transaction/    # Transaction analysis
│   │   ├── token/          # Token information and analysis
│   │   └── health/         # Health checks and monitoring
│   ├── common/
│   │   ├── interfaces/     # TypeScript interfaces
│   │   ├── dto/           # Data Transfer Objects
│   │   └── utils/         # Utility functions
│   └── config/            # Configuration files
```

## API Endpoints

### Whale Endpoints
- `GET /api/v1/whales/transactions` - Get recent whale transactions
- `GET /api/v1/whales/addresses` - Get tracked whale addresses
- `GET /api/v1/whales/addresses/:address` - Get whale address details
- `GET /api/v1/whales/addresses/:address/transactions` - Get transactions for address
- `GET /api/v1/whales/addresses/:address/tokens` - Get token holdings for address
- `GET /api/v1/whales/stats` - Get whale tracking statistics
- `GET /api/v1/whales/trending-tokens` - Get trending tokens among whales

### Transaction Endpoints
- `GET /api/v1/transactions/:hash` - Get transaction details
- `GET /api/v1/transactions/:hash/analysis` - Get transaction analysis
- `GET /api/v1/transactions/address/:address` - Get transactions for address

### Token Endpoints
- `GET /api/v1/tokens/:address` - Get token information
- `GET /api/v1/tokens/:address/holders` - Get token holders
- `GET /api/v1/tokens/:address/price` - Get token price
- `GET /api/v1/tokens/trending/whale-activity` - Get trending tokens
- `GET /api/v1/tokens/search/:query` - Search tokens

### Health Endpoints
- `GET /api/v1/health` - Service health check
- `GET /api/v1/health/ethereum` - Ethereum connection health

## WebSocket Events

Connect to `/whale-tracker` namespace:

- `new-whale-transaction` - New whale transaction detected
- `whale-stats-update` - Updated whale statistics
- `trending-tokens-update` - Updated trending tokens

## Configuration

Copy `.env.example` to `.env` and configure:

```env
# Server
PORT=3001
NODE_ENV=development

# Ethereum
ETHEREUM_RPC_URL=https://mainnet.infura.io/v3/YOUR_PROJECT_ID
ETHEREUM_WS_URL=wss://mainnet.infura.io/ws/v3/YOUR_PROJECT_ID
ETHERSCAN_API_KEY=YOUR_ETHERSCAN_API_KEY

# Whale Detection
MIN_WHALE_BALANCE_ETH=100
MIN_TRANSACTION_VALUE_ETH=50

# CORS
CORS_ORIGIN=http://localhost:8080
```

## Installation

```bash
# Install dependencies
npm install

# Start development server
npm run start:dev

# Build for production
npm run build

# Start production server
npm run start:prod
```

## Development

```bash
# Watch mode
npm run start:dev

# Debug mode
npm run start:debug

# Run tests
npm run test

# Run tests with coverage
npm run test:cov
```

## API Documentation

Once running, visit `http://localhost:3001/api/docs` for Swagger documentation.

## Monitoring

The service monitors:
- Pending transactions via WebSocket
- Confirmed transactions via block monitoring
- Whale address balances and activities
- Token transfers and purchases
- Market data and price changes

## Integration with Frontend

The backend is designed to work seamlessly with the React frontend:
- Real-time transaction updates via WebSocket
- Paginated API responses
- Consistent data structures
- CORS configured for frontend origin

## Performance Considerations

- Transaction caching to reduce RPC calls
- Rate limiting on external API calls
- Efficient WebSocket broadcasting
- Memory management for large datasets
- Configurable monitoring thresholds

## Security

- Input validation on all endpoints
- Rate limiting on API endpoints
- CORS configuration
- Environment variable protection
- Error handling without sensitive data exposure