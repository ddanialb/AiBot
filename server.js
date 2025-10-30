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
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// Store conversation history per user
const conversationHistory = new Map();

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

    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "deepseek/deepseek-r1:free",
        messages: [
          {
            role: "system",
            content:
              "You are a helpful AI assistant in a Telegram channel. Respond in a friendly and concise manner. You can understand and respond in Persian (Farsi) language.",
          },
          ...history,
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://telegram.org",
          "X-Title": "Telegram AI Bot",
        },
      }
    );

    const aiMessage = response.data.choices[0].message.content;

    // Add AI response to history
    history.push({
      role: "assistant",
      content: aiMessage,
    });

    return aiMessage;
  } catch (error) {
    console.error(
      "OpenRouter API Error:",
      error.response?.data || error.message
    );
    return "متأسفم، در حال حاضر نمی‌توانم پاسخ دهم. لطفاً دوباره تلاش کنید.";
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

      // Get AI response
      const aiResponse = await getAIResponse(text, userId);

      // Send response to the same topic
      await bot.sendMessage(chatId, aiResponse, {
        message_thread_id: messageThreadId,
        reply_to_message_id: msg.message_id,
      });

      console.log("AI response sent successfully");
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
