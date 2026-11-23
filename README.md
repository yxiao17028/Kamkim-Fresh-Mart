# KamKim Fresh Mart — Online Grocery Platform

Single-merchant online grocery storefront and operations dashboard built for **KamKim Fresh Mart** (Bandar Sungai Long, Selangor, Malaysia) according to **SRS v1.3**.

## Key Features

- **Localized Storefront (`/`)**: English (`en`), Simplified Chinese (`zh-CN`), and Bahasa Malaysia (`ms-MY`) with fixed-unit packaged groceries, category/search/stock filtering, guest checkout (secured via `guest_access_token`), registered customer order history & reorder, and policy/contact pages.
- **No-Cancellation & Merchant Item-Level Refund Policy**: Submitted orders cannot be cancelled via the website, and customer self-service refund requests are not supported. Staff/Owner can flag unavailable items, and only the Owner (or explicitly authorised merchant role) can initiate idempotent item-level partial/full refunds via the integrated payment gateway without automatically restoring physical inventory.
- **Password-Protected Admin Portal (`/admin`)**: Separate portal URL protected by `scrypt` password hashing and HMAC-signed HttpOnly cookies with two-role RBAC (`owner` vs `staff`), real-time SSE incoming order alerts, Lalamove dispatch & top-up workflow, online sales/refund reports (excluding POSPAL physical-store sales), audit trail, and email logs.
- **POSPAL OpenAPI V3 Integration**: Bidirectional catalogue & stock sync using `X-App-Id`, `X-Timestamp`, `X-Request-Id`, and `X-Sign` (`MD5`), durable outbox queue with outage tolerance, per-field ownership (preserving website-only images and extended descriptions), `product.change` webhook verification, and an Owner-only V3 API Debugger.
- **Lalamove Delivery Integration**: Live serviceability & 5-minute quotation checks, scheduled pickup slot eligibility gating (`Waiting for Slot`), fresh re-quote & customer top-up hold (`Top-up Required` / `Top-up Due`), idempotent booking, and coordinate fallback tracking.

## Getting Started

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment variables**
   Copy `.env.example` to `.env` and fill in your credentials (`POSPAL_APP_ID`, `POSPAL_APP_KEY`, `POSPAL_ACCOUNT`, `SESSION_SECRET`, etc.). Never commit `.env` to source control.
   ```bash
   cp .env.example .env
   ```

3. **Build & run**
   ```bash
   npm run build
   npm start
   ```
   - Storefront: `http://localhost:3000/`
   - Admin Portal: `http://localhost:3000/admin`

4. **Typecheck & run automated tests**
   ```bash
   npm run typecheck
   npm test
   ```
