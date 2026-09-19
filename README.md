# Tech Vibe Core Engine

Welcome to the **Tech Vibe Core Engine** repository. This is a Financial-Grade E-Commerce Core Engine with integrated Buy Now Pay Later (BNPL) and Loyalty Ledger systems. 

The backend has been rebuilt using an **API-First Decoupled Microservices** architecture to ensure high throughput, low latency, and robust financial integrity (preventing race conditions, double spending, and overselling).

## Architecture Paradigm

- **Architecture:** Distributed Microservices / Monorepo Event-Driven Architecture
- **Runtime & Framework:** Node.js 22 LTS / Fastify 5.x
- **Language:** TypeScript 5.x (Strict Mode)
- **Monorepo Management:** Turborepo & pnpm workspace

## Microservices Overview

The system is decomposed into several autonomous microservices, orchestrated behind an API Gateway:

1. **API Gateway (`apps/api-gateway`) - Port: 3000**
   - Fastify Reverse Proxy
   - Centralized Rate-Limiting & Auth Guard
   - Request ID & Logging injection

2. **Identity & KYC Service (`apps/identity-service`) - Port: 3001**
   - User registration & JWT authentication
   - Role-Based Access Control (RBAC)
   - KYC verification workflow for PayLater prerequisites

3. **Catalog & Inventory Service (`apps/catalog-service`) - Port: 3002**
   - Product catalog, categories, and SKU management
   - Inventory mutation with atomic reservation and pessimistic row locking

4. **Order & Checkout Orchestrator (`apps/order-service`) - Port: 3003**
   - Shopping cart and checkout orchestration
   - Split-payment logic (Points, TLater, Cash)
   - Order state machine and transaction rollback handling (Saga pattern)

5. **Point Ledger Service (`apps/point-service`) - Port: 3004**
   - Loyalty point wallet and double-entry ledger system
   - Idempotency guarantees for point mutation

6. **TLater Credit Engine (`apps/tlater-service`) - Port: 3005**
   - Buy Now Pay Later (BNPL) credit limit management
   - Loan contract generation and flat amortization calculations
   - Daily late penalty worker

## Technology Stack

- **Web Framework:** Fastify v5
- **Validation:** TypeBox / JSON Schema (Ajv)
- **Database & ORM:** MySQL 8.0+ InnoDB with Prisma ORM
- **Caching & Locks:** Redis v7
- **Logging:** Pino Logger
- **Testing:** Vitest

## Monorepo Structure

```text
tech-vibe-core/
├── apps/                 # Microservices
│   ├── api-gateway
│   ├── identity-service
│   ├── catalog-service
│   ├── order-service
│   ├── point-service
│   └── tlater-service
├── packages/             # Shared Libraries
│   ├── database          # Prisma schemas and clients
│   ├── logger            # Shared Pino configurations
│   ├── types             # Shared DTOs and interfaces
│   └── utils             # Shared utility functions
├── docker/               # Docker configurations
├── package.json          # Root package
└── turbo.json            # Turborepo configurations
```

## Getting Started

### Prerequisites

- Node.js 22+
- npm (v10+ / v11.19.0 recommended)
- Docker & Docker Compose (for local DB & Redis)

### Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone <repo-url>
   cd backend-techvibe
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start local infrastructure (MySQL & Redis):**
   ```bash
   npm run start
   ```
   *(This uses `docker compose -f docker/docker-compose.yml up -d`)*

4. **Environment Variables:**
   Copy `.env.example` to `.env` and fill in the necessary configuration values (Database URLs, JWT secrets, etc).

### Available Scripts

We use **Turborepo** to orchestrate scripts across the monorepo. You can run the following commands from the root directory:

- `npm run dev`: Starts all applications in development mode simultaneously.
- `npm run build`: Builds all packages and applications for production.
- `npm run test`: Runs unit and integration tests across all workspaces using Vitest.
- `npm run lint`: Runs ESLint on all packages.

## Definition of Done (DoD)

Each microservice adheres to strict engineering standards:
1. **Type Safety:** TypeScript compilation without implicit `any`.
2. **Schema Validation:** Fastify TypeBox validation for all payloads.
3. **Automated Testing:** 80% coverage on financial and inventory logic.
4. **Idempotency:** Financial mutations guarantee exactly-once processing using `Idempotency-Key`.
5. **Docker Ready:** Multi-stage `Dockerfile` available for production deployment.

&copy; 2026 reyjinnn. All rights reserved.