# Tally Connect (Electron + Express + ODBC)

This small app demonstrates an Electron UI that talks to a local Express backend which connects to Tally via ODBC.

Requirements
- Windows 64-bit
- Tally ODBC driver installed and a System DSN named `TallyODBC64_9000` (64-bit)
- Node.js (>= 16)

Setup
1. Open a terminal in the project folder.
2. Install dependencies:

```bash
npm install
```

3. Run the app:

```bash
npm start
```

What the app does
- When Electron starts it also starts an internal Express server on `http://localhost:9049`.
- Renderer can call APIs:
  - `GET /api/companies` — returns company list (attempts common table names; may need SQL tuning)
  - `GET /api/ledgers?company=CompanyName` — returns ledger rows for the company (driver-dependent)

ODBC Notes
- The ODBC driver mapping for Tally can vary by version. The code attempts a few common table names (`Company`, `$Company`, etc.) but you may need to inspect what tables the Tally ODBC driver exposes using an ODBC client (Excel, Access, or a simple ODBC browser).
- Ensure the DSN name is exactly `TallyODBC64_9000` or update `server.js` constant `DSN`.
- If you have a 32-bit Tally driver, you must match bitness between Node/driver; on Windows 64-bit you should use the 64-bit driver and DSN.

Enabling ODBC in TallyPrime (typical steps)
- Open TallyPrime and go to the Gateway of Tally.
- Press `F12: Configure` (or open `F12`/`Configuration`) and look for `Advanced Configuration` or `Connectivity` options.
- Enable `ODBC Server` and set the `Port` (default 9000). Save and restart Tally if needed.

API Endpoints
- `GET /api/health` — health check
- `GET /api/companies` — list companies available in the gateway
- `GET /api/companies/all` — list companies with best-effort counts of ledgers/stocks
- `GET /api/ledgers?company=CompanyName` — ledgers for `CompanyName`
- `GET /api/stocks?company=CompanyName` — stock items for `CompanyName`
- `GET /api/sundry-debtors?company=CompanyName` — ledgers under Sundry Debtors

Example curl calls

```bash
# list companies
curl http://localhost:9049/api/companies

# fetch ledgers for a company (URL-encode the company name)
curl "http://localhost:9049/api/ledgers?company=My%20Company%20Name"

# fetch stock items
curl "http://localhost:9049/api/stocks?company=My%20Company%20Name"
```

If you want this project to persist ledgers into MongoDB or provide more advanced sync logic, tell me and I will add an example `models/` folder and a simple sync route.
