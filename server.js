const path = require("path");
const fs = require("fs");
const http = require("http");
// const ngrok = require("ngrok");
const ngrokPath = path.join(process.resourcesPath, "bin", "ngrok.exe");
try {
  require("dotenv").config();
} catch (e) {}
try {
  const envPaths = [
    path.join(process.cwd(), ".env"),
    path.join(process.resourcesPath || process.cwd(), ".env"),
  ];
  for (const p of envPaths) {
    if (fs.existsSync(p)) {
      require("dotenv").config({ path: p });
      break;
    }
  }
} catch (e) {}
const express = require("express");
const cors = require("cors");

const odbc = require("odbc");
const nodemailer = require("nodemailer");
const { MongoClient } = require("mongodb");

// Encrypt certs
// const sslOptions = {
//   key: fs.readFileSync("C:/ProgramData/win-acme/.../privkey.pem"),
//   cert: fs.readFileSync("C:/ProgramData/win-acme/.../fullchain.pem"),
// };

// Environment variables
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";
const MONGO_URL =
  process.env.MONGODB_URL ||
  process.env.MONGO_URL ||
  "mongodb+srv://cochintraders3_db_user:G2OYNqHQV3j4R9Pt@tallydb.s87vsw5.mongodb.net/?retryWrites=true&w=majority";
const MONGO_DB = process.env.MONGODB_DB || "TallyDB";
const TALLY_DSN = process.env.TALLY_ODBC_DSN || "TallyODBC64_9000";
const TALLY_HOST = process.env.TALLY_HOST || "localhost";
const TALLY_PORT = process.env.TALLY_ODBC_PORT || 9000;
const apiKey =
  process.env.API_Key ||
  "2a54ff0c0b16c5eccf1f88c633119f3c37c3b9a697c89e875a48b435400bb755";

let mongoClient = null;
let mongoDb = null;

// MongoDB connection
async function connectToMongo() {
  if (!MONGO_URL) {
    console.warn("No MongoDB URL provided, skipping MongoDB connection");
    return null;
  }
  if (mongoDb) return mongoDb;

  try {
    const mongoOptions = {
      retryWrites: true,
      w: "majority",
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      family: 4,
    };

    console.log("Attempting to connect to MongoDB...");

    try {
      mongoClient = new MongoClient(MONGO_URL, mongoOptions);
      await mongoClient.connect();
      await mongoClient.db("admin").command({ ping: 1 });
      mongoDb = mongoClient.db(MONGO_DB);
      console.log("✓ Connected to MongoDB:", MONGO_DB);
      return mongoDb;
    } catch (tlsErr) {
      if (
        tlsErr.message &&
        tlsErr.message.includes("TLSV1_ALERT_INTERNAL_ERROR")
      ) {
        console.warn(
          "⚠ TLS error detected, attempting with relaxed TLS settings...",
        );
        const relaxedOptions = {
          ...mongoOptions,
          tls: true,
          tlsAllowInvalidCertificates: true,
          tlsAllowInvalidHostnames: true,
        };
        mongoClient = new MongoClient(MONGO_URL, relaxedOptions);
        await mongoClient.connect();
        await mongoClient.db("admin").command({ ping: 1 });
        mongoDb = mongoClient.db(MONGO_DB);
        console.log("✓ Connected to MongoDB with relaxed TLS:", MONGO_DB);
        return mongoDb;
      }
      throw tlsErr;
    }
  } catch (err) {
    console.error("✗ Error connecting to MongoDB:", err.message);
    mongoClient = null;
    mongoDb = null;
    return null;
  }
}

async function closeMongo() {
  try {
    if (mongoClient) {
      await mongoClient.close();
      mongoClient = null;
      mongoDb = null;
      console.log("MongoDB connection closed");
    }
  } catch (err) {
    console.error("Error closing MongoDB:", err.message);
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
    origin: [
      "https://api.cochintraderstirur.linkpc.net",
      "https://tally.cochintraderstirur.linkpc.net",
      "https://cochintraderstirur.linkpc.net",
    ],
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
      WHERE $_PrimaryGroup IN ('Sundry Debtors', 'Sundry Creditors')
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
    mongodb: mongoDb ? "connected" : "not connected",
    environment: NODE_ENV,
    tally: {
      dsn: TALLY_CONFIG.dsn,
      host: TALLY_CONFIG.host,
      port: TALLY_CONFIG.port,
    },
    timestamp: new Date().toISOString(),
  });
});

// MAIN SYNC ENDPOINT: Sync whatever company is currently ACTIVE in Tally
app.post("/api/sync-active-company", async (req, res) => {
  let connection;
  try {
    console.log("\n" + "=".repeat(60));
    console.log("API REQUEST: /api/sync-active-company");
    console.log("=".repeat(60));

    // Connect to Tally ODBC
    console.log("Connecting to Tally ODBC...");
    connection = await odbc.connect(TALLY_CONFIG.connectionString);
    console.log("✓ Connected to Tally\n");

    // Get the currently active company in Tally
    const activeCompany = await getActiveCompany(connection);

    if (!activeCompany) {
      await connection.close();
      console.warn("❌ No active company found in Tally");
      return res.status(404).json({
        success: false,
        error:
          "No active company found in Tally. Please open a company in Tally Prime.",
      });
    }

    const activeCompanyName = activeCompany.CompanyName;
    console.log(`Active Company in Tally: ${activeCompanyName}`);
    console.log("Fetching data...");

    // Fetch data for the active company
    const ledgers = await getCompanyLedgers(connection, activeCompanyName);
    const stocks = await getCompanyStocks(connection, activeCompanyName);
    const parties = await getCompanyParties(connection, activeCompanyName);

    await connection.close();

    console.log(
      `✓ Data fetched: Ledgers=${ledgers.length}, Stocks=${stocks.length}, Parties=${parties.length}`,
    );

    // Prepare data object
    const data = {
      companyName: activeCompanyName,
      companyDetails: {
        guid: activeCompany.CompanyGUID || null,
        companyNumber: activeCompany.CompanyNumber || null,
        address: activeCompany.Address || null,
        email: activeCompany.Email || null,
        phone: activeCompany.Phone || null,
        startDate: activeCompany.StartDate || null,
        booksFrom: activeCompany.BooksFrom || null,
      },
      ledgers: ledgers || [],
      stocks: stocks || [],
      parties: parties || [],
    };

    // Save to MongoDB
    let mongo = null;
    try {
      mongo = await connectToMongo();
    } catch (err) {
      console.warn("MongoDB not available, continuing without it");
    }

    if (mongo) {
      try {
        const col = mongo.collection("companiesData");

        console.log("Saving to MongoDB...");
        console.log(`Company: ${data.companyName}`);

        const doc = {
          companyName: data.companyName,
          companyDetails: data.companyDetails,
          ledgers: data.ledgers,
          stocks: data.stocks,
          parties: data.parties,
          fetchedAt: new Date(),
          lastSyncedAt: new Date().toISOString(),
        };

        const result = await col.updateOne(
          { companyName: data.companyName },
          {
            $set: doc,
            $setOnInsert: { firstSyncedAt: new Date() },
          },
          { upsert: true },
        );

        console.log(
          `✓ Data saved to MongoDB (${result.modifiedCount > 0 ? "updated existing" : "inserted new"})\n`,
        );

        const totalCompanies = await col.countDocuments();
        console.log(`📊 Total companies in database: ${totalCompanies}`);
      } catch (err) {
        console.error("✗ Error saving to MongoDB:", err.message);
      }
    }

    const summary = {
      companyName: data.companyName,
      totalLedgers: data.ledgers.length,
      totalStocks: data.stocks.length,
      totalParties: data.parties.length,
      syncedAt: new Date().toISOString(),
    };

    console.log("SUMMARY:", summary);
    console.log("=".repeat(60) + "\n");

    res.json({
      success: true,
      message: `Successfully synced "${data.companyName}"`,
      summary,
      data,
    });
  } catch (err) {
    console.error("✗ API Error:", err.message);
    if (connection) {
      try {
        await connection.close();
      } catch (closeErr) {
        console.error("Error closing connection:", closeErr.message);
      }
    }
    res.status(500).json({
      success: false,
      error: err.message || "Internal server error",
    });
  }
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

    // NEW APPROACH: Try to fetch data directly
    // If we can fetch data, the company IS active (ODBC only returns data for active company)
    let ledgers = [];
    let stocks = [];
    let parties = [];
    let dataFetchSuccess = false;

    console.log(`Attempting to fetch data for: ${companyName}`);

    try {
      // Try to fetch data - if this succeeds, the company is active in Tally
      ledgers = await getCompanyLedgers(connection, companyName);
      stocks = await getCompanyStocks(connection, companyName);
      parties = await getCompanyParties(connection, companyName);

      // If we got ANY data, the fetch was successful
      if (ledgers.length > 0 || stocks.length > 0 || parties.length > 0) {
        dataFetchSuccess = true;
        console.log(
          `✓ Successfully fetched data: Ledgers=${ledgers.length}, Stocks=${stocks.length}, Parties=${parties.length}`,
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

    // Save to MongoDB
    try {
      const mongo = await connectToMongo();
      if (mongo) {
        const col = mongo.collection("companiesData");

        const doc = {
          companyName: companyName,
          companyDetails: companyDetails || {},
          ledgers: ledgers || [],
          stocks: stocks || [],
          parties: parties || [],
          fetchedAt: new Date(),
          lastSyncedAt: new Date().toISOString(),
          savedLimited: !dataFetchSuccess,
        };

        const result = await col.updateOne(
          { companyName: companyName },
          {
            $set: doc,
            $setOnInsert: { firstSyncedAt: new Date() },
          },
          { upsert: true },
        );

        console.log(
          `✓ Saved to MongoDB: ${companyName} (${dataFetchSuccess ? "WITH DATA" : "LIMITED - no data"})`,
        );
      }
    } catch (mongoErr) {
      console.error("Warning: could not save to MongoDB:", mongoErr.message);
    }

    // Return response
    res.json({
      success: true,
      data: {
        companyName,
        ledgers,
        stocks,
        parties,
      },
      savedLimited: !dataFetchSuccess,
      message: dataFetchSuccess
        ? `Successfully synced ${companyName} with ${ledgers.length} ledgers, ${stocks.length} stocks, ${parties.length} parties`
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

// Get list of all companies from MongoDB
app.get("/api/companies", async (req, res) => {
  try {
    const mongo = await connectToMongo();
    if (!mongo) {
      return res.status(503).json({
        success: false,
        error: "MongoDB not configured",
      });
    }

    const col = mongo.collection("companiesData");

    const companies = await col
      .find(
        {},
        {
          projection: {
            companyName: 1,
            companyDetails: 1,
            ledgers: 1,
            stocks: 1,
            parties: 1,
            fetchedAt: 1,
            lastSyncedAt: 1,
            _id: 0,
          },
        },
      )
      .sort({ companyName: 1 })
      .toArray();

    console.log(
      `\nAPI REQUEST: /api/companies - returned ${companies.length} companies`,
    );

    res.json({
      success: true,
      count: companies.length,
      data: companies,
    });
  } catch (err) {
    console.error("Error fetching companies:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// Get full companies data including _id
app.get("/api/companies-data", async (req, res) => {
  try {
    const mongo = await connectToMongo();
    if (!mongo) {
      return res
        .status(503)
        .json({ success: false, error: "MongoDB not configured" });
    }

    const col = mongo.collection("companiesData");
    const rows = await col.find({}).sort({ companyName: 1 }).toArray();
    const data = (rows || []).map((doc) => ({
      _id: doc._id ? String(doc._id) : null,
      companyName: doc.companyName || null,
      companyDetails: doc.companyDetails || {},
      fetchedAt: doc.fetchedAt || null,
      firstSyncedAt: doc.firstSyncedAt || null,
      lastSyncedAt: doc.lastSyncedAt || null,
      ledgersCount: Array.isArray(doc.ledgers) ? doc.ledgers.length : 0,
      stocksCount: Array.isArray(doc.stocks) ? doc.stocks.length : 0,
      partiesCount: Array.isArray(doc.parties) ? doc.parties.length : 0,
    }));

    res.json({ success: true, count: data.length, data });
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

// Get data for a specific company from MongoDB
app.get("/api/company/:companyName", async (req, res) => {
  try {
    const { companyName } = req.params;

    const mongo = await connectToMongo();
    if (!mongo) {
      return res.status(503).json({
        success: false,
        error: "MongoDB not configured",
      });
    }

    const col = mongo.collection("companiesData");
    const data = await col.findOne({ companyName });

    if (!data) {
      return res.status(404).json({
        success: false,
        error: "Company not found in database",
      });
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

app.delete("/api/company/:companyName", async (req, res) => {
  try {
    const { companyName } = req.params;

    console.log(`\nAPI REQUEST: DELETE /api/company/${companyName}`);

    const mongo = await connectToMongo();
    if (!mongo) {
      return res.status(503).json({
        success: false,
        error: "MongoDB not configured",
      });
    }

    const col = mongo.collection("companiesData");

    // Check if company exists
    const existingCompany = await col.findOne({ companyName });
    if (!existingCompany) {
      console.log(`❌ Company "${companyName}" not found in database`);
      return res.status(404).json({
        success: false,
        error: "Company not found in database",
      });
    }

    // Delete the company
    const result = await col.deleteOne({ companyName });

    if (result.deletedCount === 1) {
      console.log(`✓ Successfully deleted company: "${companyName}"`);
      res.json({
        success: true,
        message: `Company "${companyName}" has been deleted successfully`,
        deletedCompany: companyName,
      });
    } else {
      console.log(`❌ Failed to delete company: "${companyName}"`);
      res.status(500).json({
        success: false,
        error: "Failed to delete company",
      });
    }
  } catch (err) {
    console.error("Error deleting company:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// Get ledgers for a specific company from MongoDB
app.get("/api/ledgers/:companyName", async (req, res) => {
  try {
    const { companyName } = req.params;

    const mongo = await connectToMongo();
    if (!mongo) {
      return res.status(503).json({
        success: false,
        error: "MongoDB not configured",
      });
    }

    const col = mongo.collection("companiesData");
    const data = await col.findOne(
      { companyName },
      { projection: { ledgers: 1, _id: 0 } },
    );

    if (!data) {
      return res.status(404).json({
        success: false,
        error: "Company not found",
      });
    }

    res.json({
      success: true,
      count: data.ledgers?.length || 0,
      data: data.ledgers || [],
    });
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

    const mongo = await connectToMongo();
    if (!mongo) {
      return res.status(503).json({
        success: false,
        error: "MongoDB not configured",
      });
    }

    const col = mongo.collection("companiesData");
    const data = await col.findOne(
      { companyName },
      { projection: { stocks: 1, _id: 0 } },
    );

    if (!data) {
      return res.status(404).json({
        success: false,
        error: "Company not found",
      });
    }

    res.json({
      success: true,
      count: data.stocks?.length || 0,
      data: data.stocks || [],
    });
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

    const mongo = await connectToMongo();
    if (!mongo) {
      return res.status(503).json({
        success: false,
        error: "MongoDB not configured",
      });
    }

    // Get stocks from companiesData collection
    const companiesCol = mongo.collection("companiesData");
    const companiesData = await companiesCol.findOne(
      { companyName },
      { projection: { stocks: 1, _id: 0 } },
    );

    if (!companiesData || !companiesData.stocks) {
      return res.status(404).json({
        success: false,
        error: "Company not found",
      });
    }

    // Get all batches for this company from stockBatches collection
    const batchesCol = mongo.collection("stockBatches");
    const batchDocs = await batchesCol.find({ companyName }).toArray();

    // Create a map of stockItem -> {batches, totalQuantity} for quick lookup
    const batchMap = {};
    for (const batchDoc of batchDocs) {
      batchMap[batchDoc.stockItem] = {
        batches: batchDoc.batches || [],
        totalQuantity: batchDoc.totalQuantity || 0,
      };
    }

    // Combine stocks with their batches
    const stocksWithBatches = (companiesData.stocks || []).map((stock) => {
      const stockName = stock.$Name || stock.StockName || "";
      const batchInfo = batchMap[stockName] || {
        batches: [],
        totalQuantity: 0,
      };
      return {
        ...stock,
        batches: batchInfo.batches,
        totalQuantity: batchInfo.totalQuantity,
      };
    });

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

    const mongo = await connectToMongo();
    if (!mongo) {
      return res.status(503).json({
        success: false,
        error: "MongoDB not configured",
      });
    }

    const col = mongo.collection("companiesData");
    const data = await col.findOne(
      { companyName },
      { projection: { parties: 1, _id: 0 } },
    );

    if (!data) {
      return res.status(404).json({
        success: false,
        error: "Company not found",
      });
    }

    res.json({
      success: true,
      count: data.parties?.length || 0,
      data: data.parties || [],
    });
  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// Send order email endpoint
app.post("/api/send-order", async (req, res) => {
  try {
    const payload = req.body;
    if (!payload)
      return res
        .status(400)
        .json({ success: false, error: "Missing request payload" });

    const transporter = getMailTransporter();
    if (!transporter)
      return res
        .status(500)
        .json({ success: false, error: "Mail transporter not configured" });

    const shopName = payload.shopName || "Unknown Shop";
    const companyName = payload.companyName || "";
    const items = Array.isArray(payload.items) ? payload.items : [];
    const contact = payload.contact || {};
    const notes = payload.notes || "";

    // Build HTML table for items
    const itemsRows = items
      .map(
        (it) => `
      <tr>
        <td style="padding:6px;border:1px solid #ddd">${it.id || ""}</td>
        <td style="padding:6px;border:1px solid #ddd">${it.name || ""}</td>
        <td style="padding:6px;border:1px solid #ddd;text-align:right">${it.pieces ?? 0}</td>
        <td style="padding:6px;border:1px solid #ddd;text-align:right">${it.sets ?? 0}</td>
        <td style="padding:6px;border:1px solid #ddd;text-align:right">${it.price ?? 0}</td>
      </tr>`,
      )
      .join("");

    const html = `
      <div>
        <h2>New Order — ${shopName}</h2>
        <p><strong>Company:</strong> ${companyName}</p>
        <p><strong>Contact:</strong> ${contact.phone || ""}</p>
        <table style="border-collapse:collapse;width:100%;margin-top:12px">
          <thead>
            <tr>
              <th style="padding:6px;border:1px solid #ddd;text-align:left">Item ID</th>
              <th style="padding:6px;border:1px solid #ddd;text-align:left">Name</th>
              <th style="padding:6px;border:1px solid #ddd;text-align:right">Pieces</th>
              <th style="padding:6px;border:1px solid #ddd;text-align:right">Sets</th>
              <th style="padding:6px;border:1px solid #ddd;text-align:right">Price</th>
            </tr>
          </thead>
          <tbody>
            ${itemsRows}
          </tbody>
        </table>
        <p style="margin-top:12px"><strong>Notes:</strong> ${notes}</p>
        <p style="font-size:12px;color:#666">Sent at ${new Date().toLocaleString()}</p>
      </div>
    `;

    // Plain text fallback
    const textLines = [];
    textLines.push(`New Order — ${shopName}`);
    textLines.push(`Company: ${companyName}`);
    textLines.push(`Contact: ${contact.phone || ""}`);
    textLines.push("Items:");
    items.forEach((it) =>
      textLines.push(
        ` - ${it.id || ""} | ${it.name || ""} | pieces:${it.pieces ?? 0} | sets:${it.sets ?? 0} | price:${it.price ?? 0}`,
      ),
    );
    textLines.push(`Notes: ${notes}`);
    textLines.push(`Sent at ${new Date().toLocaleString()}`);

    const mailOptions = {
      from: `${MAIL_FROM_NAME} <${MAIL_FROM_EMAIL}>`,
      to: MAIL_TO_EMAIL,
      subject: `Order: ${shopName} ${companyName ? `— ${companyName}` : ""}`,
      text: textLines.join("\n"),
      html,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("Order email sent:", info && info.messageId);

    res.json({ success: true, messageId: info && info.messageId });
  } catch (err) {
    console.error("Error sending order email:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Send collection payload as email (new endpoint)
app.post("/api/send-collection", async (req, res) => {
  try {
    const payload = req.body;
    if (!payload)
      return res
        .status(400)
        .json({ success: false, error: "Missing request payload" });

    const transporter = getMailTransporter();
    if (!transporter)
      return res
        .status(500)
        .json({ success: false, error: "Mail transporter not configured" });

    const type = payload.type || "";
    const shopName = payload.shopName || "Unknown Shop";
    const amount = payload.amount ?? "";
    const empId = payload.empId || "";
    const employeeName = payload.employeeName || "";
    const location = payload.location || null;
    const timestamp = new Date().toLocaleString();

    // Build HTML body
    const html = `
      <div>
        <h2>Collection Notification — ${shopName}</h2>
        <p><strong>Type:</strong> ${type}</p>
        <p><strong>Employee ID:</strong> ${empId}</p>
        <p><strong>Employee Name:</strong> ${employeeName}</p>
        <p><strong>Location:</strong> ${location ? JSON.stringify(location) : ""}</p>
        <pre style="background:#f6f6f6;padding:10px;border-radius:4px">${JSON.stringify(payload, null, 2)}</pre>
        <p style="font-size:12px;color:#666">Sent at ${timestamp}</p>
      </div>
    `;

    // Plain text fallback
    const textLines = [];
    textLines.push(`Collection Notification — ${shopName}`);
    textLines.push(`Type: ${type}`);
    textLines.push(`Amount: ${amount}`);
    if (empId) textLines.push(`Employee ID: ${empId}`);
    if (employeeName) textLines.push(`Employee Name: ${employeeName}`);
    if (location) textLines.push(`Location: ${JSON.stringify(location)}`);
    textLines.push("Full payload:");
    textLines.push(JSON.stringify(payload, null, 2));
    textLines.push(`Sent at ${timestamp}`);

    const mailOptions = {
      from: `${MAIL_FROM_NAME} <${MAIL_FROM_EMAIL}>`,
      to: MAIL_TO_EMAIL || "orders.cochintraders@outlook.com",
      subject: `Collection: ${shopName}`,
      text: textLines.join("\n"),
      html,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("Collection email sent:", info && info.messageId);

    res.json({ success: true, messageId: info && info.messageId });
  } catch (err) {
    console.error("Error sending collection email:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Alias endpoint for convenience: POST /api/collection -> forwards to /api/send-collection logic
app.post("/api/collection", async (req, res) => {
  // reuse the same handler logic by forwarding the request body
  req.url = "/api/send-collection";
  app._router.handle(req, res);
});

// Test MongoDB connection endpoint
app.get("/api/test-mongo", async (req, res) => {
  try {
    const mongo = await connectToMongo();
    if (!mongo) {
      return res.status(503).json({
        success: false,
        error: "MongoDB connection failed. Check server logs for details.",
      });
    }

    const testCol = mongo.collection("connectionTest");
    const testDoc = { test: true, timestamp: new Date() };
    await testCol.insertOne(testDoc);
    await testCol.deleteOne({ _id: testDoc._id });

    res.json({
      success: true,
      message: "MongoDB connection successful",
      database: MONGO_DB,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// Aggregated stats across all companies
app.get("/api/stats", async (req, res) => {
  try {
    const mongo = await connectToMongo();
    if (!mongo)
      return res
        .status(503)
        .json({ success: false, error: "MongoDB not configured" });

    const col = mongo.collection("companiesData");

    const pipeline = [
      {
        $project: {
          ledgersCount: { $size: { $ifNull: ["$ledgers", []] } },
          stocksCount: { $size: { $ifNull: ["$stocks", []] } },
          partiesCount: { $size: { $ifNull: ["$parties", []] } },
        },
      },
      {
        $group: {
          _id: null,
          totalCompanies: { $sum: 1 },
          totalLedgers: { $sum: "$ledgersCount" },
          totalStocks: { $sum: "$stocksCount" },
          totalParties: { $sum: "$partiesCount" },
        },
      },
    ];

    const agg = await col.aggregate(pipeline).toArray();
    const stats =
      agg && agg[0]
        ? agg[0]
        : {
            totalCompanies: 0,
            totalLedgers: 0,
            totalStocks: 0,
            totalParties: 0,
          };

    res.json({
      success: true,
      data: {
        totalCompanies: stats.totalCompanies || 0,
        totalLedgers: stats.totalLedgers || 0,
        totalStocks: stats.totalStocks || 0,
        totalParties: stats.totalParties || 0,
      },
    });
  } catch (err) {
    console.error("/api/stats error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/counts/companies", async (req, res) => {
  try {
    const mongo = await connectToMongo();
    if (!mongo)
      return res
        .status(503)
        .json({ success: false, error: "MongoDB not configured" });
    const col = mongo.collection("companiesData");
    const count = await col.countDocuments();
    res.json({ success: true, count });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/counts/ledgers", async (req, res) => {
  try {
    const mongo = await connectToMongo();
    if (!mongo)
      return res
        .status(503)
        .json({ success: false, error: "MongoDB not configured" });
    const col = mongo.collection("companiesData");
    const agg = await col
      .aggregate([
        { $project: { n: { $size: { $ifNull: ["$ledgers", []] } } } },
        { $group: { _id: null, total: { $sum: "$n" } } },
      ])
      .toArray();
    const count = agg && agg[0] ? agg[0].total || 0 : 0;
    res.json({ success: true, count });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/counts/stocks", async (req, res) => {
  try {
    const mongo = await connectToMongo();
    if (!mongo)
      return res
        .status(503)
        .json({ success: false, error: "MongoDB not configured" });
    const col = mongo.collection("companiesData");
    const agg = await col
      .aggregate([
        { $project: { n: { $size: { $ifNull: ["$stocks", []] } } } },
        { $group: { _id: null, total: { $sum: "$n" } } },
      ])
      .toArray();
    const count = agg && agg[0] ? agg[0].total || 0 : 0;
    res.json({ success: true, count });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/counts/parties", async (req, res) => {
  try {
    const mongo = await connectToMongo();
    if (!mongo)
      return res
        .status(503)
        .json({ success: false, error: "MongoDB not configured" });
    const col = mongo.collection("companiesData");
    const agg = await col
      .aggregate([
        { $project: { n: { $size: { $ifNull: ["$parties", []] } } } },
        { $group: { _id: null, total: { $sum: "$n" } } },
      ])
      .toArray();
    const count = agg && agg[0] ? agg[0].total || 0 : 0;
    res.json({ success: true, count });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Return list of company names stored in database (lightweight)
app.get("/api/company-names", async (req, res) => {
  try {
    const mongo = await connectToMongo();
    if (!mongo)
      return res
        .status(503)
        .json({ success: false, error: "MongoDB not configured" });

    const col = mongo.collection("companiesData");
    const rows = await col
      .find({}, { projection: { companyName: 1, lastSyncedAt: 1, _id: 0 } })
      .sort({ companyName: 1 })
      .toArray();

    const names = (rows || []).map((r) => ({
      companyName: r.companyName || "",
      lastSyncedAt: r.lastSyncedAt || null,
    }));

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

    const mongo = await connectToMongo();
    if (!mongo) {
      return res
        .status(503)
        .json({ success: false, error: "MongoDB not configured" });
    }

    const col = mongo.collection("stockBatches");

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

    const result = await col.updateOne(
      { companyName, stockItem },
      {
        $set: document,
      },
      { upsert: true },
    );

    console.log(
      `Batch upserted for ${companyName} - ${stockItem}:`,
      result.upsertedId || result.modifiedCount,
    );

    res.json({
      success: true,
      message: `Batches for ${stockItem} saved successfully`,
      companyName,
      stockItem,
      batchCount: validBatches.length,
      totalQuantity: document.totalQuantity,
      upserted: !!result.upsertedId,
    });
  } catch (err) {
    console.error("/api/add-batches error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get stock batches for a particular stock item
app.get("/api/batches/:companyName/:stockItem", async (req, res) => {
  try {
    const { companyName, stockItem } = req.params;

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

    const mongo = await connectToMongo();
    if (!mongo) {
      return res
        .status(503)
        .json({ success: false, error: "MongoDB not configured" });
    }

    const col = mongo.collection("stockBatches");
    const doc = await col.findOne({ companyName, stockItem });

    if (!doc) {
      return res.json({
        success: true,
        found: false,
        message: `No batches found for ${stockItem} in ${companyName}`,
        companyName,
        stockItem,
        batches: [],
      });
    }

    res.json({
      success: true,
      found: true,
      companyName: doc.companyName,
      stockItem: doc.stockItem,
      batches: doc.batches || [],
      totalQuantity: doc.totalQuantity || 0,
      batchCount: (doc.batches || []).length,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    });
  } catch (err) {
    console.error("/api/batches/:companyName/:stockItem error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get all stock batches for a particular company
app.get("/api/get-batches/:companyName", async (req, res) => {
  try {
    const { companyName } = req.params;

    if (!companyName) {
      return res
        .status(400)
        .json({ success: false, error: "companyName is required" });
    }

    const mongo = await connectToMongo();
    if (!mongo) {
      return res
        .status(503)
        .json({ success: false, error: "MongoDB not configured" });
    }

    const col = mongo.collection("stockBatches");
    const docs = await col
      .find({ companyName })
      .sort({ stockItem: 1 })
      .toArray();

    if (!docs || docs.length === 0) {
      return res.json({
        success: true,
        found: false,
        message: `No batches found for company: ${companyName}`,
        companyName,
        count: 0,
        data: [],
      });
    }

    const formattedData = docs.map((doc) => ({
      stockItem: doc.stockItem,
      batches: doc.batches || [],
      totalQuantity: doc.totalQuantity || 0,
      batchCount: (doc.batches || []).length,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    }));

    res.json({
      success: true,
      found: true,
      companyName,
      count: docs.length,
      data: formattedData,
    });
  } catch (err) {
    console.error("/api/get-batches/:companyName error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Cleanup endpoint
app.post("/api/cleanup-old-records", async (req, res) => {
  try {
    const mongo = await connectToMongo();
    if (!mongo) {
      return res
        .status(503)
        .json({ success: false, error: "MongoDB not configured" });
    }

    const col = mongo.collection("companiesData");
    const result = await col.updateMany({}, { $unset: { date: "", note: "" } });

    console.log(`Cleaned up ${result.modifiedCount} records`);

    res.json({
      success: true,
      message: `Removed old fields from ${result.modifiedCount} records`,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create order and reduce stock batches
app.post("/api/orders/:companyName/:shopName", async (req, res) => {
  try {
    const { companyName, shopName } = req.params;
    const orderItems = req.body;

    // Validate inputs
    if (!companyName || !shopName) {
      return res.status(400).json({
        success: false,
        error: "companyName and shopName are required",
      });
    }

    if (!Array.isArray(orderItems) || orderItems.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Request body must be a non-empty array of items",
      });
    }

    // Validate each item has stockItem and pieces
    for (const item of orderItems) {
      if (!item.stockItem) {
        return res.status(400).json({
          success: false,
          error: "Each item must have a stockItem field",
        });
      }
      if (!item.pieces || typeof item.pieces !== "object") {
        return res.status(400).json({
          success: false,
          error: "Each item must have a pieces object",
        });
      }
    }

    const mongo = await connectToMongo();
    if (!mongo) {
      return res
        .status(503)
        .json({ success: false, error: "MongoDB not configured" });
    }

    const batchesCol = mongo.collection("stockBatches");

    // Process each order item
    const processedItems = [];

    for (const item of orderItems) {
      const { stockItem, pieces } = item;

      // Find batch document for this company and stock item
      const batchDoc = await batchesCol.findOne({ companyName, stockItem });

      if (!batchDoc) {
        return res.status(404).json({
          success: false,
          error: `No batches found for stockItem "${stockItem}" in company "${companyName}"`,
        });
      }

      // Process pieces and update batches
      const itemBatches = batchDoc.batches || [];
      const orderedBatches = [];

      // Iterate through requested pieces (batch sizes and quantities)
      for (const [batchSizeKey, requestedQty] of Object.entries(pieces)) {
        const batchSize = parseInt(batchSizeKey);
        const quantity = parseInt(requestedQty);

        if (quantity <= 0) continue; // Skip zero quantities

        // Find batch with matching size
        const matchingBatch = itemBatches.find((b) => b.size === batchSize);

        if (!matchingBatch) {
          return res.status(400).json({
            success: false,
            error: `Batch size ${batchSize} not found for stockItem "${stockItem}"`,
          });
        }

        if (matchingBatch.quantity < quantity) {
          return res.status(400).json({
            success: false,
            error: `Insufficient quantity for batch size ${batchSize}. Available: ${matchingBatch.quantity}, Requested: ${quantity}`,
          });
        }

        orderedBatches.push({
          size: batchSize,
          orderedQty: quantity,
          availableQty: matchingBatch.quantity,
        });
      }

      if (orderedBatches.length === 0) {
        return res.status(400).json({
          success: false,
          error: `No valid pieces provided for stockItem "${stockItem}"`,
        });
      }

      // Update batches in MongoDB
      for (const orderedBatch of orderedBatches) {
        await batchesCol.updateOne(
          { companyName, stockItem, "batches.size": orderedBatch.size },
          { $inc: { "batches.$.quantity": -orderedBatch.orderedQty } },
        );
      }
      const totalOrderedForItem = orderedBatches.reduce(
        (sum, b) => sum + b.orderedQty,
        0,
      );
      await batchesCol.updateOne(
        { companyName, stockItem },
        {
          $inc: { totalQuantity: -totalOrderedForItem },
          $set: { updatedAt: new Date() },
        },
      );
      const _updatedDoc = await batchesCol.findOne(
        { companyName, stockItem },
        { projection: { totalQuantity: 1, batches: 1, updatedAt: 1 } },
      );
      const _batchCount = (_updatedDoc?.batches || []).length;
      const _totalQty = _updatedDoc?.totalQuantity || 0;
      const _updatedAt = _updatedDoc?.updatedAt;

      processedItems.push({
        stockItem,
        orderedBatches,
        totalPieces: orderedBatches.reduce((sum, b) => sum + b.orderedQty, 0),
      });
      if (processedItems.length > 0) {
        processedItems[processedItems.length - 1].totals = {
          totalQuantity: _totalQty,
          batchCount: _batchCount,
          updatedAt: _updatedAt,
        };
      }
    }

    // Calculate total pieces
    const totalCountAllPieces = processedItems.reduce(
      (sum, item) => sum + item.totalPieces,
      0,
    );

    // Build and send email
    try {
      const transporter = getMailTransporter();
      if (!transporter) {
        console.warn("Mail transporter not configured, skipping email");
      } else {
        // Build email HTML with table
        let tableRows = "";

        for (const item of processedItems) {
          const batchSizes = item.orderedBatches
            .map((b) => b.size)
            .sort((a, b) => a - b)
            .join(", ");

          tableRows += `<tr>
            <td style="padding:8px;border:1px solid #ddd">${item.stockItem}</td>
            <td style="padding:8px;border:1px solid #ddd;text-align:center">${batchSizes}</td>
            <td style="padding:8px;border:1px solid #ddd;text-align:right">
              ${item.orderedBatches.map((b) => `Size ${b.size}: ${b.orderedQty}`).join("<br/>")}
            </td>
          </tr>`;
        }

        const html = `
          <div style="font-family:Arial,sans-serif;max-width:800px;margin:0 auto;background:#f9f9f9;padding:20px;border-radius:8px">
            <h2 style="color:#333;border-bottom:3px solid #2196F3;padding-bottom:10px">Order Confirmation</h2>
            
            <div style="background:white;padding:15px;margin:15px 0;border-radius:4px;border-left:4px solid #2196F3">
              <p style="margin:5px 0"><strong>Company:</strong> ${companyName}</p>
              <p style="margin:5px 0"><strong>Shop Name:</strong> ${shopName}</p>
              <p style="margin:5px 0"><strong>Total Count:</strong> <span style="font-size:18px;color:#2196F3;font-weight:bold">${totalCountAllPieces}</span></p>
              <p style="margin:5px 0"><strong>Order Date:</strong> ${new Date().toLocaleString()}</p>
            </div>

            <h3 style="color:#333;margin-top:20px">Order Items</h3>
            <table style="border-collapse:collapse;width:100%;background:white">
              <thead>
                <tr style="background:#2196F3;color:white">
                  <th style="padding:10px;border:1px solid #ddd;text-align:left">Stock Item</th>
                  <th style="padding:10px;border:1px solid #ddd;text-align:center">Batch Sizes</th>
                  <th style="padding:10px;border:1px solid #ddd;text-align:right">Quantity by Batch</th>
                </tr>
              </thead>
              <tbody>
                ${tableRows}
              </tbody>
            </table>

            <div style="background:#e3f2fd;padding:15px;margin-top:20px;border-radius:4px;border-left:4px solid #2196F3">
              <p style="margin:0;color:#333"><strong>✓ Order has been successfully processed and stock batches have been reduced.</strong></p>
            </div>

            <p style="font-size:12px;color:#999;margin-top:20px;text-align:center">This is an automated message. Please do not reply.</p>
          </div>
        `;

        const textLines = [];
        textLines.push("=".repeat(50));
        textLines.push("ORDER CONFIRMATION");
        textLines.push("=".repeat(50));
        textLines.push(`Company: ${companyName}`);
        textLines.push(`Shop: ${shopName}`);
        textLines.push(`Total Count: ${totalCountAllPieces}`);
        textLines.push(`Date: ${new Date().toLocaleString()}`);
        textLines.push("");
        textLines.push("ORDER ITEMS:");
        textLines.push("-".repeat(50));

        for (const item of processedItems) {
          textLines.push(`\nStock Item: ${item.stockItem}`);
          for (const batch of item.orderedBatches) {
            textLines.push(
              `  - Batch Size ${batch.size}: ${batch.orderedQty} units`,
            );
          }
        }

        textLines.push("\n" + "=".repeat(50));
        textLines.push("Order processed successfully");
        textLines.push("=".repeat(50));

        const mailOptions = {
          from: `${MAIL_FROM_NAME} <${MAIL_FROM_EMAIL}>`,
          to: MAIL_TO_EMAIL || "orders.cochintraders@outlook.com",
          subject: `Order: Shop: ${shopName} — Company: ${companyName}`,
          text: textLines.join("\n"),
          html,
        };

        const info = await transporter.sendMail(mailOptions);
        console.log("Order confirmation email sent:", info && info.messageId);
      }
    } catch (mailErr) {
      console.error("Error sending order email:", mailErr.message);
      // Don't fail the entire request if email fails
    }

    // Return success response
    res.json({
      success: true,
      message: `Order placed and stock batches updated successfully for ${shopName}`,
      companyName,
      items: processedItems,
    });
  } catch (err) {
    console.error("/api/orders error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/punch-in", async (req, res) => {
  try {
    const {
      employeeName,
      employeePhone,
      companyName,
      shopName,
      amount,
      location,
      time,
      date,
    } = req.body;

    // Validation
    if (!employeeName) {
      return res.status(400).json({
        success: false,
        error: "Employee name is required",
      });
    }
    if (!employeePhone) {
      return res.status(400).json({
        success: false,
        error: "Employee phone is required",
      });
    }
    if (!companyName) {
      return res.status(400).json({
        success: false,
        error: "Company name is required",
      });
    }
    if (!shopName) {
      return res.status(400).json({
        success: false,
        error: "Shop name is required",
      });
    }
    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: "Valid amount is required",
      });
    }
    // if (!location) {
    //   return res.status(400).json({
    //     success: false,
    //     error: "Location is required",
    //   });
    // }
    if (!time) {
      return res.status(400).json({
        success: false,
        error: "Time is required",
      });
    }
    if (!date) {
      return res.status(400).json({
        success: false,
        error: "Date is required",
      });
    }

    // Log the punch in data
    console.log("📍 New Punch In:", {
      employeeName,
      shopName,
      amount,
      time,
      date,
    });

    // Prepare email content
    const emailSubject = `Punch In - ${employeeName} - ${shopName} - ${date}`;

    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
          }
          .header {
            background-color: #780206;
            color: white;
            padding: 20px;
            text-align: center;
            border-radius: 8px 8px 0 0;
          }
          .content {
            background-color: #f9f9f9;
            padding: 20px;
            border: 1px solid #ddd;
            border-top: none;
            border-radius: 0 0 8px 8px;
          }
          table {
            border-collapse: collapse;
            width: 100%;
            margin-top: 20px;
            background-color: white;
          }
          th {
            background-color: #780206;
            color: white;
            padding: 12px;
            text-align: left;
            font-weight: bold;
          }
          td {
            padding: 12px;
            border-bottom: 1px solid #ddd;
          }
          tr:last-child td {
            border-bottom: none;
          }
          .label {
            font-weight: bold;
            color: #555;
            width: 40%;
          }
          .value {
            color: #333;
          }
          .amount {
            font-size: 18px;
            font-weight: bold;
            color: #780206;
          }
          .footer {
            margin-top: 20px;
            text-align: center;
            font-size: 12px;
            color: #666;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1 style="margin: 0;">New Punch In Record</h1>
          <p style="margin: 5px 0 0 0;">Cochin Traders</p>
        </div>
        <div class="content">
          <table>
            <tr>
              <td class="label">Employee Name:</td>
              <td class="value">${employeeName}</td>
            </tr>
            <tr>
              <td class="label">Phone Number:</td>
              <td class="value">${employeePhone}</td>
            </tr>
            <tr>
              <td class="label">Company Name:</td>
              <td class="value">${companyName}</td>
            </tr>
            <tr>
              <td class="label">Shop Name:</td>
              <td class="value">${shopName}</td>
            </tr>
            <tr>
              <td class="label">Amount:</td>
              <td class="value amount">₹${Number(amount).toLocaleString("en-IN")}</td>
            </tr>
            <tr>
              <td class="label">Date:</td>
              <td class="value">${date}</td>
            </tr>
            <tr>
              <td class="label">Time:</td>
              <td class="value">${time}</td>
            </tr>
          </table>
          <div class="footer">
            <p>This is an automated email from Cochin Traders Punch In System</p>
            <p>Sent on ${new Date().toLocaleString("en-IN", {
              timeZone: "Asia/Kolkata",
              dateStyle: "full",
              timeStyle: "long",
            })}</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const emailText = `
      New Punch In Record - Cochin Traders

      Employee Name: ${employeeName}
      Phone Number: ${employeePhone}
      Company Name: ${companyName}
      Shop Name: ${shopName}
      Amount: ₹${Number(amount).toLocaleString("en-IN")}
      Location: ${location}
      Date: ${date}
      Time: ${time}

      ---
      This is an automated email from Cochin Traders Punch In System
    `;

    // Send email
    const transporter = getMailTransporter();
    if (!transporter) {
      console.error("❌ Mail transporter not configured");
      return res.status(500).json({
        success: false,
        error: "Email service not configured on server",
      });
    }

    const mailOptions = {
      from: `"${MAIL_FROM_NAME}" <${MAIL_FROM_EMAIL}>`,
      to: `"${MAIL_TO_NAME}" <${MAIL_TO_EMAIL}>`,
      subject: emailSubject,
      html: emailHtml,
      text: emailText,
    };

    await transporter.sendMail(mailOptions);

    console.log(`✓ Punch in email sent successfully to ${MAIL_TO_EMAIL}`);
    console.log(`  Employee: ${employeeName}`);
    console.log(`  Shop: ${shopName}`);
    console.log(`  Amount: ₹${amount}`);

    res.json({
      success: true,
      message: "Punch in recorded and email sent successfully",
      data: {
        employeeName,
        shopName,
        amount,
        location,
        date,
        time,
      },
    });
  } catch (error) {
    console.error("❌ Punch in error:", error);

    if (error.code === "EAUTH") {
      return res.status(500).json({
        success: false,
        error: "Email authentication failed. Please check server credentials.",
      });
    }

    if (error.code === "ECONNECTION") {
      return res.status(500).json({
        success: false,
        error: "Failed to connect to email server. Please try again.",
      });
    }

    res.status(500).json({
      success: false,
      error: "Failed to process punch in. Please try again.",
    });
  }
});
http.createServer(app).listen(80, () => {
  console.clear();
  console.log("\n" + "=".repeat(70));
  console.log("🔷 TALLY CONNECT API SERVER STARTING... on odbc 9000 port");
  console.log("Node is running in Port:", PORT);
  console.log("\n" + "=".repeat(70));
  console.log("🌐 Public URL: https://api.cochintraderstirur.linkpc.net");
  console.log("🌐 Public URL: https://tally.cochintraderstirur.linkpc.net");
  console.log("🌐 Public URL: https://cochintraderstirur.linkpc.net");
  console.log("=".repeat(70) + "\n");

  (async () => {
    await connectToMongo();
  })();
});

app.listen(80, () => console.log(`Server running on port ${PORT}`));

// https.createServer(sslOptions, app).listen(443, () => {});
// // Start server
// app.listen(PORT, async () => {

// });

process.on("SIGINT", async () => {
  console.log("\nShutting down gracefully...");
  await closeMongo();
  process.exit(0);
});

module.exports = {
  app,
  connectToMongo,
  closeMongo,
};
