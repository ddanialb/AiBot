require("dotenv").config();
const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Telegram Bot
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
  polling: {
    interval: 300,
    autoStart: true,
    params: {
      timeout: 10,
    },
  },
});

// Configuration
const CHANNEL_ID = parseInt(process.env.CHANNEL_ID);
const TOPIC_ID = parseInt(process.env.TOPIC_ID);
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

// Store conversation history per user
const conversationHistory = new Map();

// Queue system for rate limiting
const messageQueue = [];
let isProcessing = false;
const RATE_LIMIT_DELAY = 3000; // 3 seconds between requests (20 per minute)

// Process message queue
async function processQueue() {
  if (isProcessing || messageQueue.length === 0) {
    return;
  }

  isProcessing = true;
  const { chatId, messageThreadId, userId, text, messageId } =
    messageQueue.shift();

  try {
    console.log(
      `Processing message from queue. Remaining in queue: ${messageQueue.length}`
    );

    // Send typing indicator continuously
    const typingInterval = setInterval(async () => {
      try {
        await bot.sendChatAction(chatId, "typing", {
          message_thread_id: messageThreadId,
        });
      } catch (err) {
        console.error("Error sending typing action:", err);
      }
    }, 4000); // Send typing every 4 seconds

    try {
      // Get AI response
      const aiResponse = await getAIResponse(text, userId);

      // Stop typing indicator
      clearInterval(typingInterval);

      // Send response
      await bot.sendMessage(chatId, aiResponse, {
        message_thread_id: messageThreadId,
        reply_to_message_id: messageId,
      });

      console.log("AI response sent successfully");
    } catch (innerError) {
      // Stop typing indicator on error
      clearInterval(typingInterval);
      throw innerError; // Re-throw to outer catch
    }
  } catch (error) {
    console.error("Error processing message from queue:", error);

    // Send error message to user
    try {
      await bot.sendMessage(
        chatId,
        "Sorry, an error occurred. Please try again.",
        {
          message_thread_id: messageThreadId,
          reply_to_message_id: messageId,
        }
      );
    } catch (sendError) {
      console.error("Error sending error message:", sendError);
    }
  }

  // Wait before processing next message (rate limiting)
  setTimeout(() => {
    isProcessing = false;
    processQueue(); // Process next message in queue
  }, RATE_LIMIT_DELAY);
}

// Function to call OpenRouter AI
async function getAIResponse(userMessage, userId) {
  try {
    // Get or initialize conversation history for this user
    if (!conversationHistory.has(userId)) {
      conversationHistory.set(userId, []);
    }

    const history = conversationHistory.get(userId);

    // Add user message to history
    history.push({
      role: "user",
      content: userMessage,
    });

    // Keep only last 10 messages to avoid token limits
    if (history.length > 10) {
      history.splice(0, history.length - 10);
    }

    // Format messages for Gemini API
    const geminiMessages = history.map((msg) => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    }));

    const response = await axios.post(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        contents: geminiMessages,
        systemInstruction: {
          parts: [
            {
              text: "You are a helpful AI assistant in a Telegram group. Respond in a friendly and concise manner. You can understand and respond in Persian (Farsi) language.",
            },
          ],
        },
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1000,
        },
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": GOOGLE_API_KEY,
        },
      }
    );

    const aiMessage = response.data.candidates[0].content.parts[0].text;

    // Add AI response to history
    history.push({
      role: "assistant",
      content: aiMessage,
    });

    return aiMessage;
  } catch (error) {
    console.error(
      "Google Gemini API Error:",
      error.response?.data || error.message
    );
    return "Sorry, I cannot respond at the moment. Please try again later.";
  }
}

// Handle incoming messages
bot.on("message", async (msg) => {
  try {
    const chatId = msg.chat.id;
    const messageThreadId = msg.message_thread_id;
    const userId = msg.from.id;
    const text = msg.text;

    console.log("Message received:", {
      chatId,
      messageThreadId,
      userId,
      text,
      chatType: msg.chat.type,
    });

    // Check if message is from the specific channel and topic
    if (chatId === CHANNEL_ID && messageThreadId === TOPIC_ID) {
      console.log("Message is from target channel and topic");

      // Ignore bot's own messages
      if (msg.from.is_bot) {
        return;
      }

      // Add message to queue
      messageQueue.push({
        chatId,
        messageThreadId,
        userId,
        text,
        messageId: msg.message_id,
      });

      console.log(
        `Message added to queue. Queue length: ${messageQueue.length}`
      );

      // Notify user about queue status
      if (messageQueue.length > 1) {
        const queuePosition = messageQueue.length - 1;
        const estimatedWaitTime = queuePosition * (RATE_LIMIT_DELAY / 1000);

        await bot.sendMessage(
          chatId,
          `⏳ Your message has been queued.\n📍 Position in queue: ${queuePosition}\n⏱ Estimated wait time: ${estimatedWaitTime} seconds`,
          {
            message_thread_id: messageThreadId,
            reply_to_message_id: msg.message_id,
          }
        );
      }

      // Start processing queue
      processQueue();
    } else {
      console.log("Message ignored - not from target channel/topic");
    }
  } catch (error) {
    console.error("Error handling message:", error);
  }
});

// Handle polling errors
bot.on("polling_error", (error) => {
  // Ignore network errors, only log critical ones
  if (error.code !== "EFATAL" && error.code !== "ETELEGRAM") {
    console.log("Minor polling error (ignored):", error.code);
  } else {
    console.error("Critical polling error:", error.message);
  }
});

// Express server for health check
app.get("/", (req, res) => {
  res.json({
    status: "running",
    bot: "Telegram AI Bot",
    channel: CHANNEL_ID,
    topic: TOPIC_ID,
  });
});

// API health check endpoint
app.get("/test-api", async (req, res) => {
  try {
    console.log("Testing Google Gemini API...");

    const response = await axios.post(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        contents: [
          {
            parts: [{ text: "Say 'API is working!' in one sentence." }],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 50,
        },
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": GOOGLE_API_KEY,
        },
      }
    );

    const aiResponse = response.data.candidates[0].content.parts[0].text;

    res.json({
      status: "success",
      message: "Google Gemini API is working!",
      apiResponse: aiResponse,
      model: "gemini-2.5-flash",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("API Test Error:", error.response?.data || error.message);
    res.status(500).json({
      status: "error",
      message: "Google Gemini API test failed",
      error: error.response?.data || error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(
    `Bot is listening for messages in channel ${CHANNEL_ID}, topic ${TOPIC_ID}`
  );
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("Stopping bot...");
  bot.stopPolling();
  process.exit(0);
});
