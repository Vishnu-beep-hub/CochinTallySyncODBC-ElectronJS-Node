# Cochin Traders (React Native)

This is an Expo React Native starter app that displays Stocks and Sundry Debtors by calling the Tally Connect API server that lives in your workspace.

Quick start

1. Open a terminal in this folder.
2. Install dependencies:

```bash
npm install
```

3. Start the app (requires Expo CLI or `npx expo`):

```bash
npm start
```

Notes
- The app uses an API base URL configured in `App.js`. For Android emulator use `10.0.2.2` if your server runs on localhost:3000. For iOS simulator or running on the same machine you can use `http://localhost:3000`.
- Do not modify your node server; the app consumes the server endpoints under `/api/stocks/:companyName` and `/api/parties/:companyName`.
