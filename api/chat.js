module.exports = async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        error: "OPENAI_API_KEY is missing in Vercel"
      });
    }

    const action = req.body?.action;

    /*
     * ============================================
     * TEXT TO SPEECH
     * ============================================
     */

    if (action === "tts") {

      const text = req.body?.text;

      if (!text || !text.trim()) {
        return res.status(400).json({
          error: "Text is required for voice generation"
        });
      }

      /*
       * OpenAI speech input has a maximum length.
       * The browser will split longer scripts into
       * smaller pieces when we connect the renderer.
       */
      if (text.length > 4096) {
        return res.status(400).json({
          error:
            "Text is too long for one voice request. Please split the script into smaller sections."
        });
      }

      const controller = new AbortController();

      const timeout = setTimeout(() => {
        controller.abort();
      }, 60000);

      const response = await fetch(
        "https://api.openai.com/v1/audio/speech",
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            "Authorization":
              `Bearer ${process.env.OPENAI_API_KEY}`
          },

          body: JSON.stringify({
            model: "gpt-4o-mini-tts",

            voice: "alloy",

            input: text,

            instructions:
              "Speak clearly and naturally for a short-form social media video. Use an engaging, confident and conversational tone. Do not sound robotic.",

            response_format: "mp3",

            speed: 1.0
          }),

          signal: controller.signal
        }
      );

      clearTimeout(timeout);

      if (!response.ok) {

        let errorData = {};

        try {
          errorData = await response.json();
        } catch (_) {
          errorData = {};
        }

        return res.status(response.status).json({
          error:
            errorData?.error?.message ||
            "OpenAI voice generation failed"
        });
      }

      const audioBuffer = Buffer.from(
        await response.arrayBuffer()
      );

      const audioBase64 =
        audioBuffer.toString("base64");

      return res.status(200).json({
        audio: audioBase64,
        mimeType: "audio/mpeg"
      });
    }


    /*
     * ============================================
     * EXISTING AI TEXT GENERATION
     * ============================================
     */

    const message = req.body?.message;

    const conversation =
      req.body?.conversation || [];

    if (!message || !message.trim()) {
      return res.status(400).json({
        error: "Message is required"
      });
    }

    const input =
      conversation.length > 0
        ? conversation
        : [
            {
              role: "user",
              content: message
            }
          ];

    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, 30000);

    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "Authorization":
            `Bearer ${process.env.OPENAI_API_KEY}`
        },

        body: JSON.stringify({
          model: "gpt-6-luna",
          input: input,
          max_output_tokens: 1500
        }),

        signal: controller.signal
      }
    );

    clearTimeout(timeout);

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error:
          data?.error?.message ||
          "OpenAI request failed"
      });
    }

    let reply = "";

    if (
      typeof data?.output_text === "string"
    ) {
      reply =
        data.output_text.trim();
    }

    if (
      !reply &&
      Array.isArray(data?.output)
    ) {

      const parts = [];

      for (
        const item of data.output
      ) {

        if (
          !Array.isArray(item?.content)
        ) {
          continue;
        }

        for (
          const part of item.content
        ) {

          if (
            part?.type === "output_text" &&
            typeof part?.text === "string"
          ) {
            parts.push(part.text);
          }
        }
      }

      reply =
        parts.join("\n").trim();
    }

    if (!reply) {
      return res.status(500).json({
        error:
          "OpenAI returned no text response."
      });
    }

    return res.status(200).json({
      reply: reply
    });

  } catch (error) {

    if (
      error?.name === "AbortError"
    ) {
      return res.status(504).json({
        error:
          "OpenAI request timed out"
      });
    }

    return res.status(500).json({
      error:
        error?.message ||
        "Server error"
    });
  }
};