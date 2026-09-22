# Tech Vibe Core Engine

Welcome to the **Tech Vibe Core Engine** repository. This is a Financial-Grade E-Commerce Core Engine built with an **API-First Decoupled Microservices** architecture. It includes integrated Buy Now Pay Later (BNPL), Loyalty Ledger systems, and advanced E-Commerce functionalities like Split Payment, Wishlist, Reviews, and Logistics Tracking.

The backend is engineered for high throughput, low latency, and robust financial integrity (preventing race conditions, double spending, and overselling) using Pessimistic Row Locking and Idempotency guarantees.

## Architecture Paradigm

- **Architecture:** Distributed Microservices / Monorepo Event-Driven Architecture
- **Runtime & Framework:** Node.js (v20+) / Fastify 5.x
- **Language:** TypeScript 5.x (Strict Mode)
- **Monorepo Management:** Turborepo & `pnpm` workspace
- **Database ORM:** Prisma ORM

## Microservices Overview

The system is decomposed into 6 autonomous microservices, orchestrated behind a central API Gateway:

1. **API Gateway (`apps/api-gateway`) - Port: 3000**
   - Fastify Reverse Proxy & Route Aggregation
   - Centralized Rate-Limiting & Auth Guard (JWT Verification)

2. **Identity & Support Service (`apps/identity-service`) - Port: 3001**
   - User Registration, JWT authentication, and RBAC
   - KYC Verification workflow for PayLater prerequisites
   - Multi-Address Management (Primary Address atomic toggling)
   - TechVibe Care (Support Tickets Generation)
   - Notifications System

3. **Catalog & Inventory Service (`apps/catalog-service`) - Port: 3002**
   - Product Catalog, Categories, and Promos
   - Inventory mutation with Atomic Reservation (Pessimistic Row Locking `FOR UPDATE`)
   - Wishlist Management & Product Reviews/Ratings

4. **Order & Checkout Orchestrator (`apps/order-service`) - Port: 3003**
   - Checkout orchestration using **Saga Pattern**
   - Split-payment logic (Points, TLater, Cash)
   - Promo Quota Validations
   - Order State Machine & Courier Logistics (Tracking timeline & Resi)

5. **Point Ledger Service (`apps/point-service`) - Port: 3004**
   - Loyalty point wallet using **Double-Entry Ledger** logic
   - Idempotency guarantees (`Idempotency-Key`) for point mutation to prevent double deduction

6. **TLater Credit Engine (`apps/tlater-service`) - Port: 3005**
   - Buy Now Pay Later (BNPL) credit limit management
   - Loan contract generation with **Flat Amortization calculations**
   - Penny-balancing algorithm to ensure total amortization strictly matches principal + interest.

## Technology Stack

- **Web Framework:** Fastify v5
- **Validation:** TypeBox (JSON Schema validation)
- **Database:** MySQL 8.0+ (InnoDB)
- **Caching & Locks:** Redis v7
- **Logging:** Pino Logger
- **Testing:** Vitest (Unit & Integration Tests)

---

## Step-by-Step Running the Project

### 1. Prerequisites
Ensure you have the following installed on your machine:
- **Node.js** (v20 or higher)
- **pnpm** (install via `npm i -g pnpm` or `corepack enable`)
- **MySQL** (v8.0+)
- **Redis** (v7+)

### 2. Installation
Clone the repository and install all monorepo dependencies:
```bash
git clone <repo-url>
cd backend-techvibe
pnpm install
```

### 3. Environment Variables
Copy `.env.example` to `.env` in the root folder, and also in every `apps/*` and `packages/database` directory if needed.
Ensure your Database and Redis configurations are correct in `.env`:
```env
DATABASE_URL="mysql://root:123@localhost:3306/techh"
REDIS_URL="redis://localhost:6379"
JWT_SECRET="super-secret-key"
INTERNAL_API_KEY="default-internal-secret"
```

### 4. Start Infrastructure
Before running migrations, start the required MySQL and Redis instances using Docker:
```bash
pnpm start
```
This will run the containers in the background as defined in `docker/docker-compose.yml`.

### 5. Database Setup & Migrations
Synchronize the Prisma schema with your MySQL database. 
*Note: We use `prisma db push` for this local development stage.*
```bash
pnpm --filter @tech-vibe/database exec prisma db push
```
This command will create all the necessary tables (Orders, Products, TLater Loans, Ledgers, etc.) and generate the Prisma Client.

*(Optional)* If you already have the SQL dump (`db.sql`), you can import it into your MySQL client first.

### 6. Build the Project
Build all packages and microservices using Turborepo:
```bash
pnpm build
```

### 7. Run the Application
Start all microservices concurrently in development mode:
```bash
pnpm dev
```
The services will boot up on ports `3000` to `3005`. You can now access the endpoints via the API Gateway at `http://localhost:3000`.

---

## Testing

We use **Vitest** for running fast Unit and Integration tests. Tests include concurrency tests (Race Conditions) and Saga orchestration rollbacks.
```bash
# Run tests across all workspaces
pnpm test
```

## Key Technical Explanations

1. **Saga Orchestration for Checkout:** 
   When a user checks out, the `order-service` calls multiple microservices sequentially (Stocks -> Points -> TLater). If any step fails, a **Compensation Action** (rollback) is triggered in reverse order to release points and stocks safely.
   
2. **Pessimistic Row Locking:** 
   In `catalog-service` and `tlater-service`, raw SQL queries with `FOR UPDATE` are used during concurrency-heavy mutations (e.g. deducting stock or TLater limit) to ensure transactions are processed safely under high load without race conditions.

3. **Double-Entry Ledger:**
   The `point-service` does not simply store a "balance". It records every transaction as a double-entry (Debit/Credit), ensuring a tamper-proof and auditable loyalty points history.

4. **Idempotency Keys:**
   Financial mutations require an `idempotency-key` header. This prevents the same API request from being processed twice in case of network timeouts or retries.

&copy; 2026 reyjinnn. All rights reserved.