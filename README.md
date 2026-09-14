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
- **Automated Workflow Integration:** Compatible with Base44 deployment pipelines and standard GitHub version control.

## Project Structure

```text
specialty-page-studio/
├── base44/
│   └── functions/
│       ├── approveThemeProofV2/
│       ├── getPaidDelivery/
│       ├── getPaidDeliveryV2/
│       ├── renderPaidProduction/
│       └── renderPaidProductionV2/
└── README.md
```

## Getting Started

1. Clone the repository:
```bash
git clone https://github.com/keystock99206/specialty-page-studio.git
```

2. Navigate into the directory and install dependencies:
```bash
cd specialty-page-studio
npm install
```

## Security & Contributions

All backend function updates follow strict authentication ordering protocols. Please ensure all pull requests pass authorization checks before merging into `main`.
