module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const message = req.body?.message;

    if (!message || !message.trim()) {
      return res.status(400).json({
        error: "Message is required"
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        error: "OPENAI_API_KEY is missing in Vercel"
      });
    }

    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, 25000);

    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-6-luna",
          input: message,
          max_output_tokens: 300
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

    let reply = data?.output_text;

    if (!reply && Array.isArray(data?.output)) {
      for (const item of data.output) {
        if (Array.isArray(item?.content)) {
          for (const part of item.content) {
            if (
              part?.type === "output_text" &&
              part?.text
            ) {
              reply = part.text;
              break;
            }
          }
        }

        if (reply) break;
      }
    }

    if (!reply) {
      return res.status(500).json({
        error: "OpenAI returned no text response."
      });
    }

    return res.status(200).json({
      reply: reply
    });

  } catch (error) {

    if (error?.name === "AbortError") {
      return res.status(504).json({
        error: "OpenAI request timed out"
      });
    }

    return res.status(500).json({
      error:
        error?.message ||
        "Server error"
    });
  }
};