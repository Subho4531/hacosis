# NFT Mint API

A lightweight, production-ready HTTP API for minting NFTs, tracking minting jobs, and serving token metadata. This README explains installation, configuration, API endpoints, request/response examples, security best practices, testing, deployment and common troubleshooting.

Table of contents
- [Overview](#overview)
- [Features](#features)
- [Quickstart](#quickstart)
- [Configuration / Environment variables](#configuration--environment-variables)
- [Authentication](#authentication)
- [API Endpoints](#api-endpoints)
  - [POST /mint](#post-mint)
  - [GET /mints](#get-mints)
  - [GET /mints/:id](#get-mintsid)
  - [GET /metadata/:chain/:contract/:tokenId](#get-metadatachaincontracttokenid)
  - [POST /webhooks/mint](#post-webhooksmint)
- [Webhook delivery](#webhook-delivery)
- [Idempotency and retries](#idempotency-and-retries)
- [Error handling & status codes](#error-handling--status-codes)
- [Rate limiting](#rate-limiting)
- [Local development & tests](#local-development--tests)
- [Production deployment (examples)](#production-deployment-examples)
- [Security best practices](#security-best-practices)
- [Contributing](#contributing)
- [License](#license)
- [Contact](#contact)

---

## Overview

NFT Mint API provides endpoints to:
- Submit minting jobs (on-chain or via an L2)
- Track mint job status (queued, pending, confirmed, failed)
- Serve token metadata (IPFS/HTTP)
- Receive asynchronous updates via webhooks

It is intended to be used by dApps, marketplaces, or backend services that need a simple REST interface to mint tokens without embedding wallet logic in the client.

## Features
- REST API with JSON
- Supports multiple chains/providers via provider URL configuration
- Job queue with persistent status and retries
- Optional IPFS support (pinning services)
- API key and HMAC support for webhook verification
- Idempotent mint submission with client-provided idempotency key
- Configurable rate limits and concurrency

## Quickstart (local)

1. Clone repo and install:
   - npm
     ```
     git clone <repo>
     cd nft-mint-api
     npm install
     ```
2. Create a `.env` file (see next section for required variables).
3. Start server:
   ```
   npm run start
   ```
4. Run tests:
   ```
   npm test
   ```

## Configuration / Environment variables

Below are the most common environment variables. Your repository may include an `.env.example` — use that as a template.

- NODE_ENV - environment (development|production)
- PORT - HTTP server port (default: 3000)
- DATABASE_URL - connection string to your DB (Postgres, SQLite, etc)
- REDIS_URL - redis instance for queue (optional)
- WEB3_PROVIDER_URL - JSON-RPC or WebSocket provider (Alchemy, Infura, etc)
- MNEMONIC or PRIVATE_KEY - private key used by the minting wallet
- CHAIN_ID - default chain id for mints
- IPFS_API_URL - (optional) IPFS pinning service endpoint
- IPFS_API_KEY - (optional)
- API_KEY - main API key for authenticating calls to this API
- HMAC_SECRET - secret for webhook signature verification
- SENTRY_DSN - (optional) error reporting
- RATE_LIMIT_REQUESTS - per minute default
- RATE_LIMIT_WINDOW - window size (seconds)

Keep private keys and secrets out of source control. Use secret managers in production (Vault, AWS Secrets Manager, GitHub Secrets, etc).

## Authentication

Two supported approaches (configurable):
1. API Key: Send header `Authorization: Bearer <API_KEY>`. The server validates against configured keys (single key or list stored in DB/secret manager).
2. HMAC signature (optional): Useful for inter-service calls. The client signs the JSON body with HMAC-SHA256 using a shared secret and passes the signature in `X-Signature`. The server validates signature and timestamp (to avoid replay).

Example:
- Header:
  ```
  Authorization: Bearer your_api_key_here
  X-Request-Timestamp: 2025-11-01T08:00:00Z
  X-Signature: sha256=abcdef123456...
  ```

## API Endpoints

Base URL: http://localhost:3000 (adjust for your environment)

All responses are JSON. Unless otherwise specified, calls require Authorization.

### POST /mint
Create a new mint job.

Request
- Headers: Authorization Bearer API_KEY, Content-Type: application/json
- Body:
  ```
  {
    "idempotency_key": "client-provided-unique-string", // optional but recommended
    "chain": "ethereum",                 // or polygon, goerli, etc
    "contract_address": "0x...",         // optional: if omitted, a default factory contract will be used
    "to": "0xrecipientAddress",
    "metadata": {
      "name": "My NFT",
      "description": "A great NFT",
      "image": "ipfs://Q... or https://... ",
      "attributes": [
        { "trait_type": "Background", "value": "Blue" }
      ]
    },
    "mint_options": {
      "royalty": { "recipient": "0x...", "bps": 500 },
      "mint_as_lazy": false,             // if true, skip on-chain mint, create lazy metadata
      "payment_token": null
    },
    "callback_url": "https://example.com/webhooks/mints" // optional
  }
  ```

Response (201 Created)
  ```
  {
    "mint_id": "uuid-or-db-id",
    "status": "queued",
    "submitted_at": "2025-11-01T08:05:00Z",
    "estimated_completion_seconds": 45
  }
  ```

Notes:
- If you provide an idempotency_key and retry the same request, the server will return the same mint_id and status instead of creating a duplicate job.
- If `mint_as_lazy` is true, the API will store and return metadata and a signature payload but will not submit the transaction on-chain.

### GET /mints
List mint jobs (paginated)

Query params:
- page (default 1)
- per_page (default 20)
- status (optional: queued, pending, confirmed, failed)
- chain (optional)

Response:
  ```
  {
    "data": [
      { "mint_id": "1", "to":"0x..", "status":"confirmed", "tx_hash":"0x..", ... }
    ],
    "page": 1,
    "per_page": 20,
    "total": 123
  }
  ```

### GET /mints/:id
Get details for a single mint job.

Response:
  ```
  {
    "mint_id": "1",
    "status": "confirmed",
    "to":"0x..",
    "contract_address":"0x..",
    "token_id":"123",
    "tx_hash":"0x..",
    "metadata": { ... },
    "events": [
      { "time": "2025-11-01T08:06:00Z", "type":"tx_submitted", "details":{ ... } },
      { "time": "2025-11-01T08:07:10Z", "type":"tx_confirmed", "confirmations":12 }
    ],
    "created_at": "2025-11-01T08:05:00Z",
    "updated_at": "2025-11-01T08:07:10Z"
  }
  ```

### GET /metadata/:chain/:contract/:tokenId
Serve token metadata (can proxy IPFS or local DB). Good for marketplaces requesting token info.

Response:
  ```
  {
    "name": "My NFT",
    "description": "A great NFT",
    "image": "ipfs://Q...",
    "attributes": [ ... ]
  }
  ```

Headers include Cache-Control directives to minimize repeated loads.

### POST /webhooks/mint
This is an endpoint your application can create to receive asynchronous events. The API will call the callback_url you provide when the mint status changes (queued -> pending -> confirmed -> failed).

Sample delivered payload:
  ```
  {
    "mint_id": "1",
    "status": "confirmed",
    "chain": "ethereum",
    "contract_address": "0x..",
    "token_id":"123",
    "tx_hash":"0x..",
    "timestamp":"2025-11-01T08:07:10Z"
  }
  ```

Security:
- The server will sign webhook payloads using HMAC-SHA256 and include `X-Signature: sha256=...` header and `X-Timestamp`. Verify to trust events.

## Webhook delivery
- Retries: webhooks are retried with exponential backoff for non-2xx responses.
- Idempotency: each webhook contains mint_id and event_id. Keep track to avoid duplicate processing.
- Signature: verify `X-Signature` header using your HMAC secret.

## Idempotency and retries
- Use `idempotency_key` to ensure a single user action doesn't create duplicate on-chain mints. The server persists the mapping of idempotency_key -> mint job.
- The server handles transient RPC failures by retrying the transaction submission a configurable number of times. Long-running transactions are tracked and updated when confirmations occur.

## Error handling & status codes

Common status codes:
- 200 OK - success for GET/POST where no resource creation
- 201 Created - mint job created
- 400 Bad Request - validation or malformed payload
- 401 Unauthorized - missing/invalid API key
- 403 Forbidden - access denied
- 404 Not Found - resource missing
- 409 Conflict - idempotency or contract conflict
- 429 Too Many Requests - rate limit exceeded
- 500 Internal Server Error - unexpected server error

Example error body:
```
{
  "error": {
    "code": "invalid_input",
    "message": "Missing 'to' address",
    "details": { "field": "to" }
  }
}
```

## Rate limiting
- The API enforces configurable rate limits per API key.
- If you see 429 responses, respect Retry-After header and back off.

## Local development & tests

Example commands (project may include scripts):
- Install dependencies:
  ```
  npm install
  ```
- Start in dev (with nodemon):
  ```
  npm run dev
  ```
- Run unit tests:
  ```
  npm test
  ```
- Run lint:
  ```
  npm run lint
  ```

If using Docker:
- Build:
  ```
  docker build -t nft-mint-api:latest .
  ```
- Run:
  ```
  docker run -e PORT=3000 -e DATABASE_URL=<url> -p 3000:3000 nft-mint-api:latest
  ```

## Production deployment (examples)
- Use a service like AWS ECS, Google Cloud Run, or Kubernetes.
- Push container images to your registry.
- Use managed databases (RDS, Cloud SQL) and managed Redis.
- Use a secure secret store.
- Ensure the node that signs transactions is protected (hardware wallet or secured key management).

## Security best practices
- Never commit PRIVATE_KEY, MNEMONIC, or API_KEY to source control.
- Store keys in a secrets manager.
- Use rate-limits and monitoring to detect abuse.
- Use HSM or KMS for signing production transactions if possible.
- Rotate API keys and HMAC secrets periodically.
- Verify webhook signatures in consumers.
- Limit privileges of the minting account (mint-only) and configure contract-level access controls where possible.

## Example client usage (curl & Node)

Mint with curl:
```
curl -X POST https://api.example.com/mint \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "idempotency_key": "order-123",
    "chain":"polygon",
    "to":"0xabc123...",
    "metadata":{"name":"My NFT","description":"desc","image":"ipfs://Q..."},
    "callback_url":"https://my.app/hooks/mints"
  }'
```

Node (fetch):
```js
const res = await fetch("https://api.example.com/mint", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${process.env.API_KEY}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    idempotency_key: "order-123",
    chain: "polygon",
    to: "0xabc123...",
    metadata: { name: "My NFT", description: "desc", image: "ipfs://Q..." },
    callback_url: "https://my.app/hooks/mints"
  })
});
const json = await res.json();
console.log(json);
```

## Contributing
- Please open issues for bugs or feature requests.
- Follow the repository contribution guidelines:
  - Create a feature branch.
  - Write tests for new functionality.
  - Open a pull request with a descriptive title and description.

## Troubleshooting
- If mint never moves from `queued`:
  - Check worker/queue process logs.
  - Ensure WEB3_PROVIDER_URL is reachable.
- If transactions fail with nonce/insufficient funds:
  - Ensure the signing wallet has enough native tokens for gas on the configured chain.
- If webhooks not delivered:
  - Check callback URL is publicly reachable and returns 2xx.
  - Confirm firewall or WAF is not blocking provider IPs.

## License
Specify your license here (e.g., MIT). Replace this line with a LICENSE file in the repo.

## Contact
Maintainer: your-team@example.com
