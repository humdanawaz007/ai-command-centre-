module.exports = async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {

    /*
     * ============================================
     * ENVIRONMENT CHECK
     * ============================================
     */

    const action = req.body?.action;

    /*
     * ============================================
     * MARKET DATA
     *
     * Server-side market-data request.
     * This keeps external data requests away
     * from the browser.
     *
     * PAPER TRADING ONLY.
     * ============================================
     */

    if (action === "market_data") {

      const requestedSymbol =
        String(req.body?.symbol || "NIFTY")
          .trim()
          .toUpperCase();

      const symbolMap = {

        NIFTY: "^NSEI",

        SENSEX: "^BSESN",

        RELIANCE: "RELIANCE.NS",

        TCS: "TCS.NS",

        INFY: "INFY.NS",

        HDFCBANK: "HDFCBANK.NS",

        ICICIBANK: "ICICIBANK.NS",

        SBIN: "SBIN.NS"

      };

      const yahooSymbol =
        symbolMap[requestedSymbol];

      if (!yahooSymbol) {

        return res.status(400).json({
          error: "Unsupported market symbol",
          supportedSymbols:
            Object.keys(symbolMap)
        });

      }

      const yahooUrl =
        "https://query1.finance.yahoo.com/v8/finance/chart/" +
        encodeURIComponent(yahooSymbol) +
        "?range=1d&interval=5m";

      const controller =
        new AbortController();

      const timeout =
        setTimeout(() => {
          controller.abort();
        }, 15000);

      let response;

      try {

        response = await fetch(
          yahooUrl,
          {
            method: "GET",
            headers: {
              "User-Agent":
                "Mozilla/5.0"
            },
            signal: controller.signal
          }
        );

      } finally {

        clearTimeout(timeout);

      }

      if (!response.ok) {

        return res.status(502).json({
          error:
            "Market data provider returned an error",
          providerStatus:
            response.status
        });

      }

      const data =
        await response.json();

      const result =
        data?.chart?.result?.[0];

      if (!result) {

        return res.status(502).json({
          error:
            "No market data was returned"
        });

      }

      const meta =
        result.meta || {};

      const timestamps =
        result.timestamp || [];

      const quote =
        result.indicators?.quote?.[0] || {};

      const closes =
        quote.close || [];

      const opens =
        quote.open || [];

      const highs =
        quote.high || [];

      const lows =
        quote.low