# Lumina Backend

[![E2E Pipeline](https://github.com/stellar-network-builders/wavelum-backend/actions/workflows/e2e-pipeline.yml/badge.svg)](https://github.com/stellar-network-builders/wavelum-backend/actions/workflows/e2e-pipeline.yml)
![Pipeline SLA](https://img.shields.io/badge/pipeline%20SLA-%3C30%20min-brightgreen)

Node.js backend API and services for the Lumina Network â€” a blockchain-based vesting vault and token streaming platform on Stellar Soroban.

## Overview

Lumina Backend provides the off-chain infrastructure powering the Lumina ecosystem. It includes a REST API, GraphQL endpoint, WebSocket server, job queue workers, Soroban integration services, and database management â€” all containerized for scalable deployment.

## Architecture

```
lumina-backend/
â”œâ”€â”€ backend/             # Express.js REST API server
â”œâ”€â”€ src/                 # NestJS application services
â”‚   â”œâ”€â”€ services/        # Business logic services
â”‚   â””â”€â”€ utils/           # Shared utilities
â”œâ”€â”€ routes/              # API route definitions
â”œâ”€â”€ workers/             # Background job workers
â”œâ”€â”€ db/                  # Database migrations and seeds
â”œâ”€â”€ tests/               # Test suites
â”œâ”€â”€ kubernetes/          # K8s deployment manifests
â”œâ”€â”€ helm/                # Helm charts
â”œâ”€â”€ scripts/             # Utility scripts
â”œâ”€â”€ legacy_cleanup/      # Legacy migration tooling
â”œâ”€â”€ docker-compose.yml   # Local development setup
â””â”€â”€ docker-compose-scalable.yml  # Production-grade deployment
```

## Features

- **REST API** â€” Express.js server for vesting schedule management, claims processing, and administrative operations
- **GraphQL API** â€” Apollo GraphQL endpoint for flexible data queries
- **WebSocket Server** â€” Real-time event streaming via Socket.IO and NestJS WebSockets
- **Soroban Integration** â€” Stellar Soroban SDK client for on-chain contract interactions
- **Background Workers** â€” Bull/BullMQ job queue workers for async processing (vesting, Soroban indexer, PII scrubbing)
- **Analytics** â€” Off-chain vesting analytics and historical data aggregation
- **Authentication** â€” JWT-based auth with Passport.js and NestJS guards
- **File Processing** â€” CSV and xlsx report generation, file upload handling via Multer
- **Notification System** â€” SendGrid email integration

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | [Node.js](https://nodejs.org/) >= 20.11 |
| API Framework | [Express.js](https://expressjs.com/) + [NestJS](https://nestjs.com/) |
| GraphQL | [Apollo Server](https://www.apollographql.com/) |
| WebSockets | [Socket.IO](https://socket.io/) |
| Database | [PostgreSQL](https://www.postgresql.org/) + [Knex](https://knexjs.org/) migrations |
| Cache/Queue | [Redis](https://redis.io/) + [BullMQ](https://bullmq.io/) / [Bull](https://optimalbits.github.io/bull/) |
| Blockchain | [Stellar SDK](https://github.com/stellar/stellar-sdk) + [Soroban Client](https://github.com/stellar/soroban-client) |
| Auth | [JWT](https://jwt.io/) + [Passport.js](https://www.passportjs.org/) |
| Storage | [IPFS](https://ipfs.tech/) (web3.storage), [Cloudinary](https://cloudinary.com/), [AWS S3](https://aws.amazon.com/s3/) |
| Logging | [Winston](https://github.com/winstonjs/winston) + [Sentry](https://sentry.io/) |
| Payment | [Stripe](https://stripe.com/) |
| Testing | [Jest](https://jestjs.io/) + [Supertest](https://github.com/ladjs/supertest) |
| Deployment | [Docker](https://www.docker.com/), [Kubernetes](https://kubernetes.io/), [Helm](https://helm.sh/) |
| Documentation | [Swagger](https://swagger.io/) (swagger-autogen + swagger-ui-express) |

## Getting Started

### Prerequisites

- Node.js >= 20.11
- PostgreSQL
- Redis

### Installation

```bash
npm install
cp .env.example .env
# Configure your environment variables
npm run migrate
npm run dev
```

### Commands

| Command | Description |
|---------|-------------|
| `npm start` | Start Express API server |
| `npm run dev` | Start server with hot reload (nodemon) |
| `npm start:ws` | Start NestJS WebSocket server |
| `npm run worker` | Start background job worker |
| `npm run soroban` | Start Soroban indexer worker |
| `npm run test` | Run Jest test suite |
| `npm run migrate` | Run database migrations |
| `npm run docs` | Generate Swagger documentation |

## API Documentation

API documentation is auto-generated via Swagger. After starting the server:

```
http://localhost:3000/api/docs
```

## Deployment

The project includes comprehensive deployment configurations:

```bash
# Docker Compose (development)
docker compose up

# Docker Compose (production-ready with scaling)
docker compose -f docker-compose-scalable.yml up

# Kubernetes
kubectl apply -f kubernetes/

# Helm
helm install lumina ./helm
```

## Related Repositories

- [lumina-frontend](https://github.com/stellar-network-builders/lumina-frontend) â€” Next.js web dashboard
- [lumina-core](https://github.com/stellar-network-builders/lumina-core) â€” Soroban smart contracts
