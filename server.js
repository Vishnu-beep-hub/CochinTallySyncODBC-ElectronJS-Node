const path = require("path");
const fs = require("fs");
// const { swan } = require("child_process")
try {
  // Try loading .env from multiple locations
  const envPath = process.env.ASAR_RESOURCE_PATH
    ? path.join(process.env.ASAR_RESOURCE_PATH, ".env")
    : path.join(__dirname, ".env");

  console.log("[ENV] Attempting to load .env from:", envPath);
  console.log("[ENV] .env file exists:", fs.existsSync(envPath));

  require("dotenv").config({ path: envPath });
  require("dotenv").config(); // Also try default location

  console.log(
    "[ENV] Firebase Config Loaded - DB URL:",
    process.env.FIREBASE_DB_URL ? "✓" : "✗",
  );
  console.log("[ENV] Tally DSN:", process.env.TALLY_ODBC_DSN || "default");
} catch (e) {
  console.warn("[ENV] Warning: Issue loading .env -", e.message);
}
const express = require("express");
const cors = require("cors");
const odbc = require("odbc");
const nodemailer = require("nodemailer");
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";

// Firebase config from .env file
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DATABASE_URL,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
  measurementId: process.env.FIREBASE_MEASUREMENT_ID,
};

console.log("[Server Init] Firebase config loaded from .env");
console.log("[Server Init] Firebase project:", firebaseConfig.projectId);
const TALLY_DSN = process.env.TALLY_ODBC_DSN || "TallyODBC64_9000";
const TALLY_HOST = process.env.TALLY_HOST || "localhost";
const TALLY_PORT = process.env.TALLY_ODBC_PORT || 9000;
const apiKey =
  process.env.API_Key ||
  "2a54ff0c0b16c5eccf1f88c633119f3c37c3b9a697c89e875a48b435400bb755";

let firebaseApp = null;
let firebaseDb = null;
let FB = null;
let realtimeDb = null;
let RD = null;
const rtdbInvalidCharRegex = /[.#$/[\]]/g;
const rtdbSlug = (s) =>
  String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";
const rtdbSanitizeKeys = (obj) => {
  const out = {};
  Object.keys(obj || {}).forEach((k) => {
    const noDollar = k.replace(/^\$+/, "");
    const cleaned = noDollar.replace(rtdbInvalidCharRegex, "_").trim();
    const key = cleaned || "field";
    out[key] = obj[k];
  });
  return out;
};

// Firebase Firestore connection (reuse function name connectToMongo for minimal changes)
async function connectToMongo() {
  try {
    const useFs =
      String(process.env.FIREBASE_USE_FIRESTORE || "").toLowerCase() === "true";
    if (!firebaseApp) {
      const appMod = await import("firebase/app");
      const { initializeApp } = appMod;
      firebaseApp = initializeApp(firebaseConfig);
    }
    firebaseDb = FB.getFirestore(firebaseApp);
    return firebaseDb;
  } catch (err) {
    console.error("✗ Error connecting to Firebase:", err.message);
    firebaseApp = null;
    firebaseDb = null;
    return null;
  }
}

async function closeMongo() {
  try {
    firebaseApp = null;
    firebaseDb = null;
  } catch (err) {
    console.error("Error closing Firebase:", err.message);
  }
}

async function connectToRealtime() {
  try {
    if (realtimeDb) {
      console.log("[Firebase] Using cached Realtime Database connection");
      return realtimeDb;
    }

    console.log("[Firebase] Initializing Realtime Database connection...");

    if (!firebaseApp) {
      console.log("[Firebase] Initializing Firebase App...");
      const appMod = await import("firebase/app");
      const { initializeApp } = appMod;
      firebaseApp = initializeApp(firebaseConfig);
    }
    if (!RD) {
      RD = await import("firebase/database");
    }

    let dbUrl = process.env.FIREBASE_DB_URL || firebaseConfig.databaseURL || "";
    dbUrl = String(dbUrl || "")
      .replace(/`/g, "")
      .trim();
    if (!dbUrl) {
      dbUrl = `https://${firebaseConfig.projectId}-default-rtdb.firebaseio.com`;
    }

    console.log("[Firebase] Connecting to:", dbUrl);
    realtimeDb = RD.getDatabase(firebaseApp, dbUrl);
    console.log("[Firebase] ✓ Realtime Database connected successfully");
    return realtimeDb;
  } catch (err) {
    console.error("[Firebase] ✗ Connection failed:", err.message);
    realtimeDb = null;
    return null;
  }
}

const app = express();

app.use((req, res, next) => {
  const key = req.headers["x-api-key"];
  if (key !== apiKey) {
    return res.status(403).send("Forbidden");
  }
  next();
});

app.use(
  cors({
    origin: ["http://localhost:3000"],
  }),
);
app.use(express.json({ limit: "40mb" }));

// Tally ODBC Configuration
const TALLY_CONFIG = {
  dsn: TALLY_DSN,
  host: TALLY_HOST,
  port: TALLY_PORT,
  connectionString: `DSN=${TALLY_DSN};SERVER=${TALLY_HOST};PORT=${TALLY_PORT};`,
};

console.log("Tally Configuration:", {
  DSN: TALLY_CONFIG.dsn,
  Host: TALLY_CONFIG.host,
  Port: TALLY_CONFIG.port,
});

// Mail configuration (from .env)
const MAIL_FROM_EMAIL =
  process.env.MAIL_FROM_EMAIL || "cochintraders3@gmail.com";
const MAIL_FROM_PASS = process.env.MAIL_FROM_PASS || "sisl hskd vocg bwxz";
const MAIL_FROM_NAME = process.env.MAIL_FROM_NAME || "Cochin Traders";
const MAIL_TO_EMAIL =
  process.env.MAIL_TO_EMAIL || "orders.cochintraders@outlook.com";
const MAIL_TO_NAME = process.env.MAIL_TO_NAME || "Orders";

let mailTransporter = null;
function getMailTransporter() {
  if (mailTransporter) return mailTransporter;
  if (!MAIL_FROM_EMAIL || !MAIL_FROM_PASS) {
    console.warn(
      "Mail credentials not configured in environment; email disabled",
    );
    return null;
  }

  mailTransporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: MAIL_FROM_EMAIL,
      pass: MAIL_FROM_PASS,
    },
  });

  // Verify transporter early to catch auth errors on startup
  mailTransporter
    .verify()
    .then(() => console.log("✓ Mail transporter verified"))
    .catch((err) => console.error("✗ Mail verify failed:", err.message));

  return mailTransporter;
}

// Get the active company (improved version)
async function getActiveCompany(connection) {
  try {
    console.log("Attempting to detect active company...");

    // Verify a company is loaded
    try {
      await connection.query(`SELECT TOP 1 $Name FROM LEDGER`);
      console.log(
        "✓ Successfully queried LEDGER - a company is definitely loaded",
      );
    } catch (err) {
      console.log("No ledger data accessible - no company may be loaded");
      return null;
    }

    // Get all companies
    const companies = await connection.query(`
      SELECT 
        $Name as CompanyName,
        $GUID as CompanyGUID,
        $_CompanyNumber as CompanyNumber,
        $StartingFrom as StartDate,
        $BooksFrom as BooksFrom,
        $Address as Address,
        $Email as Email,
        $Phone as Phone
      FROM COMPANY
    `);

    if (!companies || companies.length === 0) {
      console.warn("No company data returned from Tally");
      return null;
    }

    console.log(`Found ${companies.length} companies in Tally:`);
    companies.forEach((c, i) => {
      const name = c.CompanyName || c.$Name || c.Name;
      console.log(`  ${i + 1}. ${name}`);
    });

    // If only one company, it's active
    if (companies.length === 1) {
      const single = companies[0];
      console.log(
        `✓ Single company present, treating as active: ${single.CompanyName}`,
      );
      return {
        CompanyName: single.CompanyName ?? single.$Name ?? single.Name,
        CompanyGUID: single.CompanyGUID ?? single.$GUID,
        CompanyNumber:
          single.CompanyNumber ??
          single._CompanyNumber ??
          single["$_CompanyNumber"],
        StartDate: single.StartDate ?? single.$StartingFrom,
        BooksFrom: single.BooksFrom ?? single.$BooksFrom,
        Address: single.Address ?? single.$ADDRESS,
        Email: single.Email ?? single.$EMAIL,
        Phone: single.Phone ?? single.$PHONE,
      };
    }

    // For multiple companies, return the first one (ODBC will only return data for active company anyway)
    console.warn(
      "Multiple companies found. Returning first company - ODBC queries will only return data for the actually active one.",
    );
    const first = companies[0];
    return {
      CompanyName: first.CompanyName ?? first.$Name ?? first.Name,
      CompanyGUID: first.CompanyGUID ?? first.$GUID,
      CompanyNumber:
        first.CompanyNumber ?? first._CompanyNumber ?? first["$_CompanyNumber"],
      StartDate: first.StartDate ?? first.$StartingFrom,
      BooksFrom: first.BooksFrom ?? first.$BooksFrom,
      Address: first.Address ?? first.$ADDRESS,
      Email: first.Email ?? first.$EMAIL,
      Phone: first.Phone ?? first.$PHONE,
    };
  } catch (error) {
    console.error("Error fetching active company:", error.message);
    return null;
  }
}

// Get ledgers from active company
async function getCompanyLedgers(connection, companyName) {
  try {
    const query = `
      SELECT 
        $Name as LedgerName,
        $Parent as ParentGroup,
        $ClosingBalance as ClosingBalance,
        $OpeningBalance as OpeningBalance,
        $_PrimaryGroup as PrimaryGroup,
        $Address as Address,
        $Email as Email,
        $Phone as Phone,
        $MailingName as MailingName
      FROM LEDGER
      ORDER BY $ClosingBalance ASC
    `;
    const results = await connection.query(query);
    return results.map((ledger) => ({ ...ledger, CompanyName: companyName }));
  } catch (error) {
    console.error(`Error fetching ledgers:`, error.message);
    return [];
  }
}

// Get stock items from active company
async function getCompanyStocks(connection, companyName) {
  try {
    const query = `
      SELECT 
        $Name as StockName,
        $Parent as Category,
        $ClosingBalance as ClosingQty,
        $ClosingRate as ClosingRate,
        $ClosingValue as ClosingValue,
        $OpeningBalance as OpeningQty,
        $OpeningRate as OpeningRate,
        $OpeningValue as OpeningValue,
        $BaseUnits as Unit
      FROM STOCKITEM
      ORDER BY $ClosingValue ASC
    `;
    const results = await connection.query(query);
    return results.map((stock) => ({ ...stock, CompanyName: companyName }));
  } catch (error) {
    console.error(`Error fetching stocks:`, error.message);
    return [];
  }
}

// Get all parties from active company
async function getCompanyParties(connection, companyName) {
  try {
    const query = `
      SELECT 
        $Name as PartyName,
        $Parent as PartyType,
        $_PrimaryGroup as PrimaryGroup,
        $ClosingBalance as Balance,
        $OpeningBalance as OpeningBalance,
        $Address as Address,
        $Email as Email,
        $Phone as Phone,
        $ContactPerson as ContactPerson,
        $MailingName as MailingName
      FROM LEDGER
      WHERE $_PrimaryGroup IN ('Sundry Debtors')
      ORDER BY $_PrimaryGroup, $ClosingBalance ASC
    `;
    const results = await connection.query(query);
    return results.map((party) => ({ ...party, CompanyName: companyName }));
  } catch (error) {
    console.error(`Error fetching parties:`, error.message);
    return [];
  }
}

// API Routes
// Example route
app.get("/", (req, res) => {
  res.send("Hello, Server HTTPS is running 🚀");
});

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    firebase: firebaseDb ? "connected" : "not connected",
    environment: NODE_ENV,
    tally: {
      dsn: TALLY_CONFIG.dsn,
      host: TALLY_CONFIG.host,
      port: TALLY_CONFIG.port,
    },
    timestamp: new Date().toISOString(),
  });
});

// Get list of all companies directly from Tally (ODBC)
app.get("/api/tally-companies", async (req, res) => {
  let connection;
  try {
    console.log(
      "API REQUEST: /api/tally-companies — fetching from Tally via ODBC",
    );
    connection = await odbc.connect(TALLY_CONFIG.connectionString);
    const rows = await connection.query(`
      SELECT
        $Name as CompanyName,
        $GUID as CompanyGUID,
        $_CompanyNumber as CompanyNumber,
        $StartingFrom as StartDate,
        $BooksFrom as BooksFrom,
        $Address as Address,
        $Email as Email,
        $Phone as Phone
      FROM COMPANY
    `);
    await connection.close();

    const data = (rows || []).map((r) => ({
      companyName: r.CompanyName ?? r.$Name ?? r.Name,
      companyGUID: r.CompanyGUID ?? r.$GUID,
      companyNumber: r.CompanyNumber ?? r._CompanyNumber,
      startDate: r.StartDate ?? r.$StartingFrom,
      booksFrom: r.BooksFrom ?? r.$BooksFrom,
      address: r.Address ?? r.$ADDRESS,
      email: r.Email ?? r.$EMAIL,
      phone: r.Phone ?? r.$PHONE,
    }));

    res.json({ success: true, count: data.length, data });
  } catch (err) {
    console.error("/api/tally-companies error:", err.message);
    try {
      if (connection) await connection.close();
    } catch (e) {}
    res.status(500).json({ success: false, error: err.message });
  }
});

// FIXED: Sync a specific company by name - directly attempts to fetch data
app.post("/api/sync-tally/:companyName", async (req, res) => {
  const { companyName } = req.params;
  const providedDetails =
    req.body && req.body.companyDetails ? req.body.companyDetails : null;
  let connection;
  try {
    console.log(`\nAPI REQUEST: POST /api/sync-tally/${companyName}`);
    connection = await odbc.connect(TALLY_CONFIG.connectionString);

    // NEW APPROACH: Try to fetch data directly (stocks + ledgers; derive parties from ledgers)
    // If we can fetch data, the company IS active (ODBC only returns data for active company)
    let stocks = [];
    let ledgers = [];
    let derivedParties = [];
    let dataFetchSuccess = false;

    console.log(`Attempting to fetch data for: ${companyName}`);

    try {
      // Try to fetch data - if this succeeds, the company is active in Tally
      stocks = await getCompanyStocks(connection, companyName);
      ledgers = await getCompanyLedgers(connection, companyName);
      // Derive parties from ledgers: pick Sundry Debtors/Creditors
      const isParty = (l) => {
        const pg = (
          l.PrimaryGroup ||
          l["$_PrimaryGroup"] ||
          l.ParentGroup ||
          ""
        )
          .toString()
          .toLowerCase();
        return pg.includes("sundry debtor") || pg.includes("sundry creditor");
      };
      derivedParties = Array.isArray(ledgers) ? ledgers.filter(isParty) : [];
      // Keep only non-party ledgers
      ledgers = Array.isArray(ledgers)
        ? ledgers.filter((l) => !isParty(l))
        : [];

      // If we got ANY data, the fetch was successful
      if (
        stocks.length > 0 ||
        ledgers.length > 0 ||
        derivedParties.length > 0
      ) {
        dataFetchSuccess = true;
        console.log(
          `✓ Successfully fetched data: Stocks=${stocks.length}, Ledgers=${ledgers.length}, DerivedParties=${derivedParties.length}`,
        );
      } else {
        console.log(
          `⚠ No data returned - company may be empty or not currently open in Tally`,
        );
      }
    } catch (fetchErr) {
      console.error(`✗ Failed to fetch data:`, fetchErr.message);
    }

    await connection.close();

    // Get company details
    let companyDetails = providedDetails;
    if (!companyDetails || Object.keys(companyDetails).length === 0) {
      // Try to get company details from Tally
      const tempConn = await odbc.connect(TALLY_CONFIG.connectionString);
      try {
        const companyRows = await tempConn.query(`
          SELECT 
            $Name as CompanyName,
            $GUID as CompanyGUID,
            $_CompanyNumber as CompanyNumber,
            $StartingFrom as StartDate,
            $BooksFrom as BooksFrom,
            $Address as Address,
            $Email as Email,
            $Phone as Phone
          FROM COMPANY
        `);

        // Find matching company
        const matchedCompany = companyRows.find((c) => {
          const cName = c.CompanyName || c.$Name || c.Name || "";
          return (
            cName.toLowerCase().trim() === companyName.toLowerCase().trim()
          );
        });

        if (matchedCompany) {
          companyDetails = {
            guid: matchedCompany.CompanyGUID || matchedCompany.$GUID || null,
            companyNumber:
              matchedCompany.CompanyNumber ||
              matchedCompany._CompanyNumber ||
              null,
            address: matchedCompany.Address || matchedCompany.$ADDRESS || null,
            email: matchedCompany.Email || matchedCompany.$EMAIL || null,
            phone: matchedCompany.Phone || matchedCompany.$PHONE || null,
            startDate:
              matchedCompany.StartDate || matchedCompany.$StartingFrom || null,
            booksFrom:
              matchedCompany.BooksFrom || matchedCompany.$BooksFrom || null,
          };
          console.log("✓ Fetched company details from Tally");
        }
      } catch (e) {
        console.warn("Could not fetch company details:", e.message);
      } finally {
        await tempConn.close();
      }
    }

    try {
      const rdb = await connectToRealtime();
      if (rdb && RD) {
        const companyId = rtdbSlug(companyName);
        const basePath = `companiesData/${companyId}`;
        await RD.update(RD.ref(rdb, basePath), {
          companyName: companyName,
          companyDetails: companyDetails || {},
          firstSyncedAt: Date.now(),
        });
        const makeId = (colName, item, index) => {
          const guid =
            item?.$GUID || item?.$MasterId || item?.GUID || item?.MasterId;
          if (guid) return String(guid);
          let base = "";
          if (colName === "stocks")
            base = item?.$Name || item?.StockName || item?.Name || "";
          else if (colName === "ledgers")
            base = item?.$Name || item?.LedgerName || item?.Name || "";
          else
            base =
              item?.$Name ||
              item?.MailingName ||
              item?.PartyName ||
              item?.LedgerName ||
              item?.Name ||
              "";
          const id = rtdbSlug(base);
          return id || `item-${index}`;
        };
        const writeIndividual = async (colName, items, batchSize = 500) => {
          const arr = Array.isArray(items) ? items : [];
          let i = 0;
          while (i < arr.length) {
            const end = Math.min(i + batchSize, arr.length);
            const updates = {};
            for (let j = i; j < end; j++) {
              const raw = arr[j];
              const id = makeId(colName, raw, j);
              const it = rtdbSanitizeKeys(raw);
              updates[`${basePath}/${colName}/${id}`] = it;
            }
            await RD.update(RD.ref(rdb), updates);
            i = end;
          }
          await RD.update(RD.ref(rdb, `${basePath}/${colName}/_meta`), {
            totalItems: arr.length,
            lastUpdated: Date.now(),
          });
        };
        await writeIndividual("stocks", stocks || []);
        await writeIndividual("ledgers", ledgers || []);
        // Store derived parties (from ledgers) under parties subcollection
        await writeIndividual("parties", derivedParties || []);
        await RD.update(RD.ref(rdb, basePath), {
          fetchedAt: Date.now(),
          lastSyncedAt: new Date().toISOString(),
          savedLimited: !dataFetchSuccess,
          counts: {
            stocks: Array.isArray(stocks) ? stocks.length : 0,
            ledgers: Array.isArray(ledgers) ? ledgers.length : 0,
            parties: Array.isArray(derivedParties) ? derivedParties.length : 0,
          },
        });
      }
    } catch (fbErr) {
      console.error("Warning: could not save to Firebase:", fbErr.message);
    }

    // Return response
    res.json({
      success: true,
      data: {
        companyName,
        stocks,
        ledgers,
      },
      savedLimited: !dataFetchSuccess,
      message: dataFetchSuccess
        ? `Successfully synced ${companyName} with ${stocks.length} stocks, ${ledgers.length} ledgers (SD/SC moved to parties)`
        : `Company details saved but no data could be fetched. Make sure ${companyName} is open in Tally Prime.`,
    });
  } catch (err) {
    console.error("/api/sync-tally error:", err.message);
    try {
      if (connection) await connection.close();
    } catch (e) {}
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get list of all companies from Realtime Database
app.get("/api/companies", async (req, res) => {
  try {
    const rdb = await connectToRealtime();
    if (!rdb || !RD) {
      return res
        .status(503)
        .json({ success: false, error: "Firebase not configured" });
    }
    const snap = await RD.get(RD.ref(rdb, "companiesData"));
    const list = [];
    if (snap.exists()) {
      const val = snap.val() || {};
      Object.keys(val).forEach((id) => {
        const d = val[id] || {};
        list.push({
          companyName: d.companyName || id || null,
          companyDetails: d.companyDetails || {},
          fetchedAt: d.fetchedAt || null,
          lastSyncedAt: d.lastSyncedAt || null,
          counts: d.counts || {},
        });
      });
    }

    list.sort((a, b) =>
      (a.companyName || "").localeCompare(b.companyName || ""),
    );

    console.log(
      `\nAPI REQUEST: /api/companies - returned ${list.length} companies`,
    );

    res.json({ success: true, count: list.length, data: list });
  } catch (err) {
    console.error("Error fetching companies:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// Get full companies data including _id (Realtime)
app.get("/api/companies-data", async (req, res) => {
  try {
    const rdb = await connectToRealtime();
    if (!rdb || !RD) {
      return res
        .status(503)
        .json({ success: false, error: "Firebase not configured" });
    }
    const snap = await RD.get(RD.ref(rdb, "companiesData"));
    const rows = [];
    if (snap.exists()) {
      const val = snap.val() || {};
      Object.keys(val).forEach((id) => {
        const d = val[id] || {};
        const counts = d.counts || {};
        rows.push({
          _id: id,
          companyName: d.companyName || id || null,
          companyDetails: d.companyDetails || {},
          fetchedAt: d.fetchedAt || null,
          firstSyncedAt: d.firstSyncedAt || null,
          lastSyncedAt: d.lastSyncedAt || null,
          ledgersCount: counts.ledgers || 0,
          stocksCount: counts.stocks || 0,
          partiesCount: counts.parties || 0,
        });
      });
    }
    rows.sort((a, b) =>
      (a.companyName || "").localeCompare(b.companyName || ""),
    );

    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get the currently ACTIVE company from Tally
app.get("/api/active-company", async (req, res) => {
  let connection;
  try {
    console.log("\nAPI REQUEST: /api/active-company");
    connection = await odbc.connect(TALLY_CONFIG.connectionString);
    const active = await getActiveCompany(connection);
    await connection.close();

    if (!active) {
      console.log("❌ No active company found in Tally");
      return res.status(404).json({
        success: false,
        error:
          "No active company found in Tally. Please open a company in Tally Prime.",
      });
    }

    console.log(`✓ Active company: "${active.CompanyName}"`);

    res.json({
      success: true,
      data: active,
    });
  } catch (err) {
    console.error("Error fetching active company:", err.message);
    try {
      if (connection) await connection.close();
    } catch (e) {}
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get data for a specific company from Realtime Database
app.get("/api/company/:companyName", async (req, res) => {
  try {
    const { companyName } = req.params;

    const rdb = await connectToRealtime();
    if (!rdb || !RD) {
      return res
        .status(503)
        .json({ success: false, error: "Firebase not configured" });
    }

    const companyId = rtdbSlug(companyName);
    const snap = await RD.get(RD.ref(rdb, `companiesData/${companyId}`));

    if (!snap.exists()) {
      return res.status(404).json({
        success: false,
        error: "Company not found in database",
      });
    }

    const data = snap.val();

    res.json({ success: true, data });
  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// Fetch stocks subcollection for a company
app.get("/api/company/:companyName/stocks", async (req, res) => {
  try {
    const { companyName } = req.params;
    const rdb = await connectToRealtime();
    if (!rdb || !RD) {
      return res
        .status(503)
        .json({ success: false, error: "Firebase not configured" });
    }
    const companyId = rtdbSlug(companyName);
    const snap = await RD.get(RD.ref(rdb, `companiesData/${companyId}/stocks`));
    const val = snap.exists() ? snap.val() : {};
    const items = Object.keys(val || {})
      .filter((k) => k !== "_meta")
      .map((k) => ({ id: k, ...(val[k] || {}) }));
    res.json({ success: true, count: items.length, data: items });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Fetch parties (Sundry Debtors) subcollection for a company
app.get("/api/company/:companyName/parties", async (req, res) => {
  try {
    const { companyName } = req.params;
    const rdb = await connectToRealtime();
    if (!rdb || !RD) {
      return res
        .status(503)
        .json({ success: false, error: "Firebase not configured" });
    }
    const companyId = rtdbSlug(companyName);
    const snap = await RD.get(
      RD.ref(rdb, `companiesData/${companyId}/parties`),
    );
    const val = snap.exists() ? snap.val() : {};
    const items = Object.keys(val || {})
      .filter((k) => k !== "_meta")
      .map((k) => ({ id: k, ...(val[k] || {}) }));
    res.json({ success: true, count: items.length, data: items });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete("/api/company/:companyName", async (req, res) => {
  try {
    const { companyName } = req.params;

    console.log(`\nAPI REQUEST: DELETE /api/company/${companyName}`);

    const rdb = await connectToRealtime();
    if (!rdb || !RD) {
      return res
        .status(503)
        .json({ success: false, error: "Firebase not configured" });
    }

    const companyId = rtdbSlug(companyName);
    const snap = await RD.get(RD.ref(rdb, `companiesData/${companyId}`));
    if (!snap.exists()) {
      console.log(`❌ Company "${companyName}" not found in database`);
      return res.status(404).json({
        success: false,
        error: "Company not found in database",
      });
    }

    await RD.remove(RD.ref(rdb, `companiesData/${companyId}`));

    console.log(`✓ Successfully deleted company: "${companyName}"`);
    res.json({
      success: true,
      message: `Company "${companyName}" has been deleted successfully`,
      deletedCompany: companyName,
    });
  } catch (err) {
    console.error("Error deleting company:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// Get ledgers for a specific company from Realtime DB
app.get("/api/ledgers/:companyName", async (req, res) => {
  try {
    const { companyName } = req.params;
    const rdb = await connectToRealtime();
    if (!rdb || !RD) {
      return res
        .status(503)
        .json({ success: false, error: "Firebase not configured" });
    }
    const companyId = rtdbSlug(companyName);
    const snap = await RD.get(
      RD.ref(rdb, `companiesData/${companyId}/ledgers`),
    );
    const val = snap.exists() ? snap.val() : {};
    const items = Object.keys(val || {})
      .filter((k) => k !== "_meta")
      .map((k) => ({ id: k, ...(val[k] || {}) }));
    res.json({ success: true, count: items.length, data: items });
  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// Get stocks for a specific company from MongoDB
app.get("/api/stocks/:companyName", async (req, res) => {
  try {
    const { companyName } = req.params;

    try {
      const db = await connectToMongo();
      if (db && FB) {
        const ref = FB.doc(db, "companiesData", companyName);
        const snap = await FB.getDoc(ref);
        if (snap.exists()) {
          const data = snap.data() || {};
          return res.json({
            success: true,
            count: data.stocks?.length || 0,
            data: data.stocks || [],
          });
        }
      }
    } catch (_fbErr) {
      /* fall through to ODBC fallback */
    }

    let connection;
    try {
      connection = await odbc.connect(TALLY_CONFIG.connectionString);
      const active = await getActiveCompany(connection);
      if (!active) {
        return res
          .status(404)
          .json({ success: false, error: "No active company in Tally" });
      }
      const activeName = active.CompanyName || "";
      if (
        (activeName || "").toLowerCase() !== (companyName || "").toLowerCase()
      ) {
        return res.status(409).json({
          success: false,
          error: "Active company mismatch",
          activeCompany: activeName,
        });
      }
      const stocks = await getCompanyStocks(connection, companyName);
      return res.json({ success: true, count: stocks.length, data: stocks });
    } catch (odbcErr) {
      return res.status(500).json({ success: false, error: odbcErr.message });
    } finally {
      try {
        if (connection) await connection.close();
      } catch (e) {}
    }
  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// Get stocks with batches for a specific company from MongoDB
app.get("/api/stocks-with-batch/:companyName", async (req, res) => {
  try {
    const { companyName } = req.params;

    const rdb = await connectToRealtime();
    if (!rdb || !RD) {
      return res
        .status(503)
        .json({ success: false, error: "Firebase not configured" });
    }
    const companyId = rtdbSlug(companyName);
    const stocksSnap = await RD.get(
      RD.ref(rdb, `companiesData/${companyId}/stocks`),
    );
    const stocksVal = stocksSnap.exists() ? stocksSnap.val() : {};
    const stockList = Object.keys(stocksVal || {})
      .filter((k) => k !== "_meta")
      .map((k) => ({ id: k, ...(stocksVal[k] || {}) }));
    const batchesSnap = await RD.get(
      RD.ref(rdb, `companiesData/${companyId}/batches`),
    );
    const batchesVal = batchesSnap.exists() ? batchesSnap.val() : {};
    const batchMap = {};
    Object.keys(batchesVal || {}).forEach((sid) => {
      const entry = batchesVal[sid] || {};
      const blist = Object.keys(entry || {})
        .filter((k) => k !== "_meta")
        .map((k) => ({ id: k, ...(entry[k] || {}) }));
      batchMap[sid] = blist;
    });
    const stocksWithBatches = stockList.map((s) => ({
      ...s,
      batches: batchMap[s.id] || [],
      totalQuantity: (batchMap[s.id] || []).reduce(
        (sum, b) => sum + (b.quantity || 0),
        0,
      ),
    }));
    res.json({
      success: true,
      count: stocksWithBatches.length,
      data: stocksWithBatches,
    });
  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// Get parties for a specific company from MongoDB
app.get("/api/parties/:companyName", async (req, res) => {
  try {
    const { companyName } = req.params;

    try {
      const db = await connectToMongo();
      if (db && FB) {
        const ref = FB.doc(db, "companiesData", companyName);
        const snap = await FB.getDoc(ref);
        if (snap.exists()) {
          const data = snap.data() || {};
          return res.json({
            success: true,
            count: data.parties?.length || 0,
            data: data.parties || [],
          });
        }
      }
    } catch (_fbErr) {
      /* fall through to ODBC fallback */
    }

    let connection;
    try {
      connection = await odbc.connect(TALLY_CONFIG.connectionString);
      const active = await getActiveCompany(connection);
      if (!active) {
        return res
          .status(404)
          .json({ success: false, error: "No active company in Tally" });
      }
      const activeName = active.CompanyName || "";
      if (
        (activeName || "").toLowerCase() !== (companyName || "").toLowerCase()
      ) {
        return res.status(409).json({
          success: false,
          error: "Active company mismatch",
          activeCompany: activeName,
        });
      }
      const parties = await getCompanyParties(connection, companyName);
      return res.json({ success: true, count: parties.length, data: parties });
    } catch (odbcErr) {
      return res.status(500).json({ success: false, error: odbcErr.message });
    } finally {
      try {
        if (connection) await connection.close();
      } catch (e) {}
    }
  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// Alias endpoint for convenience: POST /api/collection -> forwards to /api/send-collection logic
app.post("/api/collection", async (req, res) => {
  // reuse the same handler logic by forwarding the request body
  req.url = "/api/send-collection";
  app._router.handle(req, res);
});

// Aggregated stats across all companies (Realtime DB)
app.get("/api/stats", async (req, res) => {
  try {
    const rdb = await connectToRealtime();
    if (!rdb || !RD) {
      return res
        .status(503)
        .json({ success: false, error: "Firebase not configured" });
    }
    const snap = await RD.get(RD.ref(rdb, "companiesData"));
    let totalCompanies = 0,
      totalLedgers = 0,
      totalStocks = 0,
      totalParties = 0;
    if (snap.exists()) {
      const val = snap.val() || {};
      Object.keys(val).forEach((id) => {
        totalCompanies += 1;
        const d = val[id] || {};
        const counts = d.counts || {};
        totalLedgers += counts.ledgers || 0;
        totalStocks += counts.stocks || 0;
        totalParties += counts.parties || 0;
      });
    }

    res.json({
      success: true,
      data: {
        totalCompanies,
        totalLedgers,
        totalStocks,
        totalParties,
      },
    });
  } catch (err) {
    console.error("/api/stats error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/counts/companies", async (req, res) => {
  try {
    const rdb = await connectToRealtime();
    if (!rdb || !RD) {
      return res
        .status(503)
        .json({ success: false, error: "Firebase not configured" });
    }
    const snap = await RD.get(RD.ref(rdb, "companiesData"));
    const count = snap.exists() ? Object.keys(snap.val() || {}).length : 0;
    res.json({ success: true, count });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/counts/ledgers", async (req, res) => {
  try {
    const rdb = await connectToRealtime();
    if (!rdb || !RD) {
      return res
        .status(503)
        .json({ success: false, error: "Firebase not configured" });
    }
    const snap = await RD.get(RD.ref(rdb, "companiesData"));
    let count = 0;
    if (snap.exists()) {
      const val = snap.val() || {};
      Object.keys(val).forEach((id) => {
        const d = val[id] || {};
        const counts = d.counts || {};
        count += counts.ledgers || 0;
      });
    }
    res.json({ success: true, count });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/counts/stocks", async (req, res) => {
  try {
    const rdb = await connectToRealtime();
    if (!rdb || !RD) {
      return res
        .status(503)
        .json({ success: false, error: "Firebase not configured" });
    }
    const snap = await RD.get(RD.ref(rdb, "companiesData"));
    let count = 0;
    if (snap.exists()) {
      const val = snap.val() || {};
      Object.keys(val).forEach((id) => {
        const d = val[id] || {};
        const counts = d.counts || {};
        count += counts.stocks || 0;
      });
    }
    res.json({ success: true, count });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/counts/parties", async (req, res) => {
  try {
    const rdb = await connectToRealtime();
    if (!rdb || !RD) {
      return res
        .status(503)
        .json({ success: false, error: "Firebase not configured" });
    }
    const snap = await RD.get(RD.ref(rdb, "companiesData"));
    let count = 0;
    if (snap.exists()) {
      const val = snap.val() || {};
      Object.keys(val).forEach((id) => {
        const d = val[id] || {};
        const counts = d.counts || {};
        count += counts.parties || 0;
      });
    }
    res.json({ success: true, count });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Return list of company names stored in Realtime DB (lightweight)
app.get("/api/company-names", async (req, res) => {
  try {
    const rdb = await connectToRealtime();
    if (!rdb || !RD) {
      return res
        .status(503)
        .json({ success: false, error: "Firebase not configured" });
    }
    const qSnap = await RD.get(RD.ref(rdb, "companiesData"));
    const names = [];
    if (qSnap.exists()) {
      const val = qSnap.val() || {};
      Object.keys(val).forEach((id) => {
        const d = val[id] || {};
        names.push({
          companyName: d.companyName || id || "",
          lastSyncedAt: d.lastSyncedAt || null,
        });
      });
    }
    names.sort((a, b) => a.companyName.localeCompare(b.companyName));

    res.json({ success: true, count: names.length, data: names });
  } catch (err) {
    console.error("/api/company-names error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Lightweight ODBC connectivity check (additive)
app.get("/api/tally-odbc-check", async (req, res) => {
  let connection;
  try {
    connection = await odbc.connect(TALLY_CONFIG.connectionString);
    await connection.query("SELECT TOP 1 $Name FROM COMPANY");
    try {
      await connection.close();
    } catch (e) {}
    return res.json({
      success: true,
      connected: true,
      port: TALLY_CONFIG.port,
    });
  } catch (err) {
    try {
      if (connection) await connection.close();
    } catch (e) {}
    return res.json({
      success: false,
      connected: false,
      error: err.message,
      port: TALLY_CONFIG.port,
    });
  }
});

// Add stock batches
app.post("/api/add-batches", async (req, res) => {
  try {
    const { companyName, stockItem, batches } = req.body;

    // Validate required fields
    if (!companyName) {
      return res
        .status(400)
        .json({ success: false, error: "companyName is required" });
    }
    if (!stockItem) {
      return res
        .status(400)
        .json({ success: false, error: "stockItem is required" });
    }
    if (!Array.isArray(batches) || batches.length === 0) {
      return res
        .status(400)
        .json({ success: false, error: "batches must be a non-empty array" });
    }

    const rdb = await connectToRealtime();
    if (!rdb || !RD) {
      return res
        .status(503)
        .json({ success: false, error: "Firebase not configured" });
    }

    // Validate batch items
    const validBatches = batches.filter((b) => {
      return (
        typeof b.size === "number" &&
        b.size > 0 &&
        typeof b.quantity === "number" &&
        b.quantity > 0
      );
    });

    if (validBatches.length === 0) {
      return res.status(400).json({
        success: false,
        error:
          "No valid batches found. Each batch must have size > 0 and quantity > 0",
      });
    }

    // Create or update document
    const document = {
      companyName,
      stockItem,
      batches: validBatches,
      totalQuantity: validBatches.reduce((sum, b) => sum + b.quantity, 0),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const companyId = rtdbSlug(companyName);
    const stockId = rtdbSlug(stockItem);
    const updates = {};
    const batchPath = `companiesData/${companyId}/batches/${stockId}`;
    validBatches.forEach((b, i) => {
      const bid = rtdbSlug(`${b.name || "batch"}-${i}`);
      updates[`${batchPath}/${bid}`] = rtdbSanitizeKeys(b);
    });
    await RD.update(RD.ref(rdb), updates);

    console.log(`Batch upserted for ${companyName} - ${stockItem}`);

    res.json({
      success: true,
      message: `Batches for ${stockItem} saved successfully`,
      companyName,
      stockItem,
      batchCount: validBatches.length,
      totalQuantity: document.totalQuantity,
      upserted: true,
    });
  } catch (err) {
    console.error("/api/add-batches error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

let startServer;

(async () => {
  function start(port = Number(PORT) || 3000) {
    const httpServer = app.listen(port, async () => {
      console.clear();
      console.log("\n" + "=".repeat(70));
      console.log("🔷 TALLY CONNECT API SERVER STARTING... on odbc 9000 port");
      console.log("Node is running in Port:", port);
      console.log("=".repeat(70) + "\n");
    });
    return { stop: () => new Promise((r) => httpServer.close(r)) };
  }
  startServer = start;
  if (require.main === module) {
    start();
  }
})();

process.on("SIGINT", async () => {
  console.log("\nShutting down gracefully...");
  await closeMongo();
  process.exit(0);
});

module.exports = {
  app,
  start: startServer,
  connectToMongo,
  closeMongo,
};
