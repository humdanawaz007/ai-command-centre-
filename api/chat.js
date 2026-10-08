module.exports = async function handler(req, res) {
  /*
   * =========================================================
   * AI COMMAND CENTRE - API
   * =========================================================
   *
   * Supports:
   *
   * 1. Normal AI chat/content generation
   * 2. Text-to-speech
   * 3. Market data
   * 4. Paper-trading simulation
   *
   * IMPORTANT:
   * - No real trades are executed.
   * - OPENAI_API_KEY must be configured in Vercel.
   * - This file is designed for a Vercel serverless function.
   *
   * =========================================================
   */

  /*
   * ---------------------------------------------------------
   * BASIC RESPONSE HEADERS
   * ---------------------------------------------------------
   */

  res.setHeader("Content-Type", "application/json; charset=utf-8");

  /*
   * ---------------------------------------------------------
   * METHOD CHECK
   * ---------------------------------------------------------
   */

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  /*
   * ---------------------------------------------------------
   * MAIN ERROR HANDLER
   * ---------------------------------------------------------
   */

  try {
    /*
     * =======================================================
     * ENVIRONMENT CHECK
     * =======================================================
     */

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

    /*
     * We only require the OpenAI key for AI/TTS actions.
     * Market data can work without it.
     */

    const action = req.body?.action || "chat";

    /*
     * =======================================================
     * MARKET DATA
     * =======================================================
     *
     * PAPER / INFORMATIONAL USE ONLY.
     *
     * Data source:
     * Yahoo Finance chart endpoint.
     *
     * Supported symbols:
     *
     * NIFTY
     * SENSEX
     * RELIANCE
     * TCS
     * INFY
     * HDFCBANK
     * ICICIBANK
     * SBIN
     *
     * =======================================================
     */

    if (action === "market_data") {
      const requestedSymbol = String(
        req.body?.symbol || "NIFTY"
      )
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

      const yahooSymbol = symbolMap[requestedSymbol];

      if (!yahooSymbol) {
        return res.status(400).json({
          error: "Unsupported market symbol",
          supportedSymbols: Object.keys(symbolMap)
        });
      }

      const yahooUrl =
        "https://query1.finance.yahoo.com/v8/finance/chart/" +
        encodeURIComponent(yahooSymbol) +
        "?range=1d&interval=5m";

      const controller = new AbortController();

      const timeout = setTimeout(() => {
        controller.abort();
      }, 15000);

      let response;

      try {
        response = await fetch(yahooUrl, {
          method: "GET",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (compatible; AI-Command-Centre/1.0)"
          },
          signal: controller.signal
        });
      } catch (error) {
        if (error?.name === "AbortError") {
          return res.status(504).json({
            error: "Market data request timed out"
          });
        }

        return res.status(502).json({
          error:
            "Unable to connect to market data provider",
          details: error?.message || "Network error"
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        return res.status(502).json({
          error:
            "Market data provider returned an error",
          providerStatus: response.status
        });
      }

      let data;

      try {
        data = await response.json();
      } catch (error) {
        return res.status(502).json({
          error:
            "Market data provider returned invalid JSON"
        });
      }

      const result = data?.chart?.result?.[0];

      if (!result) {
        return res.status(502).json({
          error:
            "No market data was returned"
        });
      }

      const meta = result.meta || {};

      const timestamps =
        Array.isArray(result.timestamp)
          ? result.timestamp
          : [];

      const quote =
        result.indicators?.quote?.[0] || {};

      const closes =
        Array.isArray(quote.close)
          ? quote.close
          : [];

      const opens =
        Array.isArray(quote.open)
          ? quote.open
          : [];

      const highs =
        Array.isArray(quote.high)
          ? quote.high
          : [];

      const lows =
        Array.isArray(quote.low)
          ? quote.low
          : [];

      const volumes =
        Array.isArray(quote.volume)
          ? quote.volume
          : [];

      /*
       * -------------------------------------------------------
       * Find latest valid candle
       * -------------------------------------------------------
       */

      let latestIndex = -1;

      for (let i = closes.length - 1; i >= 0; i--) {
        if (
          typeof closes[i] === "number" &&
          Number.isFinite(closes[i])
        ) {
          latestIndex = i;
          break;
        }
      }

      if (latestIndex === -1) {
        return res.status(502).json({
          error:
            "Market data did not contain a valid price"
        });
      }

      const latestPrice =
        Number(closes[latestIndex]);

      /*
       * -------------------------------------------------------
       * Find previous valid price
       * -------------------------------------------------------
       */

      let previousIndex = -1;

      for (
        let i = latestIndex - 1;
        i >= 0;
        i--
      ) {
        if (
          typeof closes[i] === "number" &&
          Number.isFinite(closes[i])
        ) {
          previousIndex = i;
          break;
        }
      }

      /*
       * -------------------------------------------------------
       * Previous close
       *
       * Prefer Yahoo's regularMarketPreviousClose
       * when available.
       * -------------------------------------------------------
       */

      let previousClose =
        Number(meta.previousClose);

      if (
        !Number.isFinite(previousClose) ||
        previousClose <= 0
      ) {
        previousClose =
          Number(meta.chartPreviousClose);
      }

      if (
        !Number.isFinite(previousClose) ||
        previousClose <= 0
      ) {
        if (previousIndex !== -1) {
          previousClose =
            Number(closes[previousIndex]);
        } else {
          previousClose = latestPrice;
        }
      }

      const change =
        latestPrice - previousClose;

      const changePercent =
        previousClose !== 0
          ? (change / previousClose) * 100
          : 0;

      /*
       * -------------------------------------------------------
       * Latest OHLC
       * -------------------------------------------------------
       */

      const latestOpen =
        Number(opens[latestIndex]);

      const latestHigh =
        Number(highs[latestIndex]);

      const latestLow =
        Number(lows[latestIndex]);

      const latestVolume =
        Number(volumes[latestIndex]);

      /*
       * -------------------------------------------------------
       * Recent candles
       * -------------------------------------------------------
       */

      const candles = [];

      for (
        let i = Math.max(0, closes.length - 100);
        i < closes.length;
        i++
      ) {
        if (
          typeof closes[i] !== "number" ||
          !Number.isFinite(closes[i])
        ) {
          continue;
        }

        candles.push({
          timestamp:
            typeof timestamps[i] === "number"
              ? timestamps[i]
              : null,

          open:
            typeof opens[i] === "number"
              ? opens[i]
              : null,

          high:
            typeof highs[i] === "number"
              ? highs[i]
              : null,

          low:
            typeof lows[i] === "number"
              ? lows[i]
              : null,

          close:
            Number(closes[i]),

          volume:
            typeof volumes[i] === "number"
              ? volumes[i]
              : null
        });
      }

      /*
       * -------------------------------------------------------
       * Market response
       * -------------------------------------------------------
       */

      return res.status(200).json({
        success: true,

        symbol: requestedSymbol,

        yahooSymbol: yahooSymbol,

        currency:
          meta.currency || "INR",

        exchange:
          meta.exchangeName ||
          meta.fullExchangeName ||
          "N/A",

        marketState:
          meta.marketState || "UNKNOWN",

        price: latestPrice,

        currentPrice: latestPrice,

        previousClose: previousClose,

        change: change,

        changePercent: changePercent,

        open:
          Number.isFinite(latestOpen)
            ? latestOpen
            : null,

        high:
          Number.isFinite(latestHigh)
            ? latestHigh
            : null,

        low:
          Number.isFinite(latestLow)
            ? latestLow
            : null,

        volume:
          Number.isFinite(latestVolume)
            ? latestVolume
            : null,

        timestamp:
          typeof timestamps[latestIndex] === "number"
            ? timestamps[latestIndex]
            : Math.floor(Date.now() / 1000),

        candles: candles,

        dataSource: "Yahoo Finance",

        paperTradingOnly: true,

        fetchedAt:
          new Date().toISOString()
      });
    }

    /*
     * =======================================================
     * PAPER TRADE
     * =======================================================
     *
     * THIS DOES NOT PLACE A REAL TRADE.
     *
     * It only validates the request and returns a simulated
     * order object.
     * =======================================================
     */

    if (action === "paper_trade") {
      const symbol = String(
        req.body?.symbol || ""
      )
        .trim()
        .toUpperCase();

      const side = String(
        req.body?.side || ""
      )
        .trim()
        .toUpperCase();

      const quantity = Number(
        req.body?.quantity
      );

      const price = Number(
        req.body?.price
      );

      if (!symbol) {
        return res.status(400).json({
          error: "Symbol is required"
        });
      }

      if (
        side !== "BUY" &&
        side !== "SELL"
      ) {
        return res.status(400).json({
          error:
            "Side must be BUY or SELL"
        });
      }

      if (
        !Number.isFinite(quantity) ||
        quantity <= 0
      ) {
        return res.status(400).json({
          error:
            "Quantity must be greater than zero"
        });
      }

      if (
        !Number.isFinite(price) ||
        price <= 0
      ) {
        return res.status(400).json({
          error:
            "Price must be greater than zero"
        });
      }

      const orderValue =
        quantity * price;

      const orderId =
        "PAPER-" +
        Date.now() +
        "-" +
        Math.random()
          .toString(36)
          .slice(2, 8)
          .toUpperCase();

      return res.status(200).json({
        success: true,

        paperTrade: true,

        realTradeExecuted: false,

        order: {
          orderId: orderId,

          symbol: symbol,

          side: side,

          quantity: quantity,

          price: price,

          value: orderValue,

          status: "SIMULATED",

          createdAt:
            new Date().toISOString()
        },

        message:
          "Paper trade simulated successfully. No real order was placed."
      });
    }

    /*
     * =======================================================
     * TEXT-TO-SPEECH
     * =======================================================
     */

    if (action === "tts") {
      if (!OPENAI_API_KEY) {
        return res.status(500).json({
          error:
            "OPENAI_API_KEY is missing in Vercel"
        });
      }

      const text = String(
        req.body?.text || ""
      ).trim();

      if (!text) {
        return res.status(400).json({
          error:
            "Text is required for voice generation"
        });
      }

      /*
       * Prevent extremely large TTS requests.
       */

      if (text.length > 4096) {
        return res.status(400).json({
          error:
            "Text is too long for one voice request. Please split the script into smaller sections."
        });
      }

      const ttsModel =
        process.env.OPENAI_TTS_MODEL ||
        "gpt-4o-mini-tts";

      const ttsVoice =
        process.env.OPENAI_TTS_VOICE ||
        "alloy";

      const controller =
        new AbortController();

      const timeout =
        setTimeout(() => {
          controller.abort();
        }, 60000);

      let response;

      try {
        response = await fetch(
          "https://api.openai.com/v1/audio/speech",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",

              "Authorization":
                `Bearer ${OPENAI_API_KEY}`
            },

            body: JSON.stringify({
              model: ttsModel,

              voice: ttsVoice,

              input: text,

              instructions:
                "Speak clearly and naturally for a short-form social media video. Use an engaging, confident and conversational tone. Do not sound robotic.",

              response_format: "mp3",

              speed: 1.0
            }),

            signal: controller.signal
          }
        );
      } catch (error) {
        if (error?.name === "AbortError") {
          return res.status(504).json({
            error:
              "Voice generation timed out"
          });
        }

        return res.status(502).json({
          error:
            "Unable to connect to OpenAI voice service",
          details:
            error?.message ||
            "Network error"
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        let errorData = {};

        try {
          errorData =
            await response.json();
        } catch (_) {
          errorData = {};
        }

        return res.status(
          response.status
        ).json({
          error:
            errorData?.error?.message ||
            "OpenAI voice generation failed"
        });
      }

      let audioBuffer;

      try {
        audioBuffer =
          Buffer.from(
            await response.arrayBuffer()
          );
      } catch (error) {
        return res.status(500).json({
          error:
            "Unable to process generated audio"
        });
      }

      const audioBase64 =
        audioBuffer.toString("base64");

      return res.status(200).json({
        success: true,

        audio: audioBase64,

        mimeType: "audio/mpeg",

        model: ttsModel,

        voice: ttsVoice
      });
    }

    /*
     * =======================================================
     * NORMAL AI CHAT / CONTENT GENERATION
     * =======================================================
     */

    if (!OPENAI_API_KEY) {
      return res.status(500).json({
        error:
          "OPENAI_API_KEY is missing in Vercel"
      });
    }

    const message =
      typeof req.body?.message === "string"
        ? req.body.message.trim()
        : "";

    const conversation =
      Array.isArray(req.body?.conversation)
        ? req.body.conversation
        : [];

    if (!message && conversation.length === 0) {
      return res.status(400).json({
        error:
          "Message is required"
      });
    }

    /*
     * -------------------------------------------------------
     * Clean conversation
     * -------------------------------------------------------
     */

    let input = [];

    if (conversation.length > 0) {
      input = conversation
        .filter((item) => {
          return (
            item &&
            typeof item === "object" &&
            typeof item.role === "string" &&
            typeof item.content === "string" &&
            item.content.trim()
          );
        })
        .map((item) => ({
          role:
            item.role === "assistant"
              ? "assistant"
              : "user",

          content:
            item.content.trim()
        }));

      /*
       * If the conversation was invalid,
       * fall back to the current message.
       */

      if (input.length === 0 && message) {
        input = [
          {
            role: "user",
            content: message
          }
        ];
      }
    } else {
      input = [
        {
          role: "user",
          content: message
        }
      ];
    }

    /*
     * -------------------------------------------------------
     * Limit conversation size
     *
     * Prevents accidentally sending a huge browser history.
     * -------------------------------------------------------
     */

    if (input.length > 30) {
      input = input.slice(-30);
    }

    /*
     * -------------------------------------------------------
     * OpenAI model
     * -------------------------------------------------------
     *
     * You can override this in Vercel with:
     *
     * OPENAI_TEXT_MODEL
     *
     * Default:
     * gpt-6-luna
     *
     * -------------------------------------------------------
     */

    const textModel =
      process.env.OPENAI_TEXT_MODEL ||
      "gpt-6-luna";

    /*
     * -------------------------------------------------------
     * AI request
     * -------------------------------------------------------
     */

    const controller =
      new AbortController();

    const timeout =
      setTimeout(() => {
        controller.abort();
      }, 60000);

    let response;

    try {
      response = await fetch(
        "https://api.openai.com/v1/responses",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            "Authorization":
              `Bearer ${OPENAI_API_KEY}`
          },

          body: JSON.stringify({
            model: textModel,

            input: input,

            instructions:
              "You are the AI Command Centre assistant. Help the user create useful, accurate and practical content. When asked to create social media content, provide clear ready-to-use output. When asked about trading or investments, provide educational information and never claim that a simulated trade is a real trade. Do not execute financial transactions.",

            max_output_tokens: 2000
          }),

          signal: controller.signal
        }
      );
    } catch (error) {
      if (error?.name === "AbortError") {
        return res.status(504).json({
          error:
            "OpenAI request timed out"
        });
      }

      return res.status(502).json({
        error:
          "Unable to connect to OpenAI",
        details:
          error?.message ||
          "Network error"
      });
    } finally {
      clearTimeout(timeout);
    }

    /*
     * -------------------------------------------------------
     * Read OpenAI response
     * -------------------------------------------------------
     */

    let data;

    try {
      data = await response.json();
    } catch (error) {
/*
     * =======================================================
     * FINAL SAFETY NET
     * =======================================================
     */

    console.error(
      "AI Command Centre API Error:",
      error
    );

    return res.status(500).json({
      error:
        error?.message ||
        "Server error"
    });
  }
};