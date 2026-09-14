# Specialty Page Studio

Specialty Page Studio is a modular TypeScript application designed to build, render, and manage custom-tailored specialty pages and dynamic digital layouts with secure backend validation.

## Architecture & Overview

The project is structured around isolated backend serverless functions and frontend rendering modules that handle:
- Authenticated theme proofs and approvals (`approveThemeProofV2`)
- Paid delivery processing and status management (`getPaidDelivery`, `getPaidDeliveryV2`)
- Secure digital/physical production rendering (`renderPaidProduction`, `renderPaidProductionV2`)

## Key Features

- **Strict Authentication Flow:** Enforces proper validation gates (`401` unauthenticated handling) prior to service-role database operations.
- **Modular Function Registry:** Clean separation of concern across TypeScript entry points.
- **Batch Processing:** Support for batch rendering operations with pagination and filtering.
- **Multiple Output Formats:** PDF, PNG, SVG, HTML, and ZIP archive support.
- **Automated Workflow Integration:** Compatible with Base44 deployment pipelines and standard GitHub version control.
- **Production-Ready:** Type-safe TypeScript with strict compiler settings and error handling.

## Project Structure

```text
specialty-page-studio/
├── base44/
│   └── functions/
│       ├── approveThemeProofV2/
│       │   └── index.ts
│       ├── getPaidDelivery/
│       │   └── index.ts
│       ├── getPaidDeliveryV2/
│       │   └── index.ts
│       ├── renderPaidProduction/
│       │   └── index.ts
│       └── renderPaidProductionV2/
│           └── index.ts
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
└── README.md
```

## Function Overview

### `approveThemeProofV2`
Authenticates and processes theme proof approval requests. Updates delivery status and records approval metadata.

**Endpoint:** `POST /functions/approveThemeProofV2`

**Request Body:**
```json
{
  "proofId": "string",
  "approved": boolean,
  "notes": "string (optional)"
}
```

### `getPaidDelivery`
Retrieves a single paid delivery record with status information.

**Endpoint:** `GET /functions/getPaidDelivery?deliveryId=<id>`

**Query Parameters:**
- `deliveryId` (required): The unique delivery identifier

### `getPaidDeliveryV2`
Enhanced delivery retrieval with filtering, pagination, and status-based queries.

**Endpoint:** `GET /functions/getPaidDeliveryV2?[userId=<id>][&status=<status>][&page=<n>][&limit=<n>]`

**Query Parameters:**
- `deliveryId` (optional): Filter by delivery ID
- `userId` (optional): Filter by user ID
- `status` (optional): Filter by delivery status
- `page` (optional, default: 1): Pagination page number
- `limit` (optional, default: 20, max: 100): Items per page

### `renderPaidProduction`
Renders production assets (PDF, PNG, SVG, HTML) for individual deliveries.

**Endpoint:** `POST /functions/renderPaidProduction`

**Request Body:**
```json
{
  "deliveryId": "string",
  "format": "pdf|png|svg|html",
  "options": {
    "width": number,
    "height": number,
    "quality": "low|medium|high"
  }
}
```

### `renderPaidProductionV2`
Batch rendering engine with support for multiple deliveries and concurrent processing.

**Endpoint:** `POST /functions/renderPaidProductionV2`

**Request Body:**
```json
{
  "deliveryIds": ["string"],
  "format": "pdf|png|svg|html|zip",
  "options": {
    "width": number,
    "height": number,
    "quality": "low|medium|high"
  },
  "batchMode": boolean
}
```

Returns HTTP 202 (Accepted) for async batch operations.

## Getting Started

### Prerequisites
- Node.js >= 18.0.0
- npm or yarn
- Supabase project (optional, for database features)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/keystock99206/specialty-page-studio.git
cd specialty-page-studio
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. Build the project:
```bash
npm run build
```

### Development

Start the development server:
```bash
npm run dev
```

Run linting:
```bash
npm run lint
```

Format code:
```bash
npm run format
```

Run tests:
```bash
npm test
```

## Authentication

All endpoints require Bearer token authentication via the `Authorization` header:

```
Authorization: Bearer <token>
```

Requests without valid authentication return `401 Unauthorized`.

### Authorization Flow

1. Client sends request with Bearer token
2. Function validates token format
3. Token validation against auth provider (implement in TODO sections)
4. User context passed to service-role database operations
5. Role-based access control enforced per function

## Database Integration

Functions use Supabase for secure database operations. Key tables:
- `theme_proofs` - Theme approval records
- `paid_deliveries` - Delivery order details
- `production_jobs` - Rendering job tracking

Update TODO sections in function files to connect your database.

## Security & Best Practices

- ✅ **Strict Authentication:** All endpoints validate bearer tokens before processing
- ✅ **Service-Role Operations:** Database writes use service-role keys in secure function context
- ✅ **Input Validation:** Request parameters validated before processing
- ✅ **Error Handling:** Consistent error response format with appropriate HTTP status codes
- ✅ **Type Safety:** Full TypeScript strict mode enabled

### Contributing

All backend function updates follow strict authentication ordering protocols. Pull requests must:

1. Maintain bearer token validation as the first operation
2. Validate all input parameters
3. Include proper error handling
4. Add TODO comments for database integration
5. Pass linting and type checks

```bash
npm run lint
npm run format
```

Before submitting:

1. Create a feature branch
2. Make changes following the authentication protocol
3. Add tests for new functions
4. Submit a pull request to `main`
5. Ensure all authorization checks pass before merge

## Deployment

### Base44 Integration

These functions are optimized for Base44 serverless deployment:

```bash
# Deploy to Base44
base44 deploy
```

### Environment Setup

Ensure the following env vars are set in your deployment:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `AUTH_SECRET`

## Support & License

For issues or questions, open a GitHub issue or contact the maintainers.

This project is licensed under the MIT License. See LICENSE file for details.

---

**Last Updated:** 2026-09-14  
**Version:** 1.0.0  
**Maintainer:** keystock99206