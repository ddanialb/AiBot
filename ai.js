require("dotenv").config();
const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const cheerio = require("cheerio");
const { wrapper } = require("axios-cookiejar-support");
const { CookieJar } = require("tough-cookie");
const fs = require("fs");
const path = require("path");

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

// Taklif Configuration
const TAKLIF_CHANNEL_ID = "-1003221138302";
const TAKLIF_TOPIC_ID = 22;
const DAILY_UPDATE_HOUR = 15; // 3 PM
const SENT_TAKLIF_FILE = path.join(__dirname, "sent_taklif.json");

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

// Function to call Gemini AI
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

// ==================== TAKLIF FUNCTIONS ====================

// Function to convert Gregorian date to Persian (Jalali) date
function gregorianToJalali(gDate) {
  const date = new Date(gDate);
  let gy = date.getFullYear();
  let gm = date.getMonth() + 1;
  const gd = date.getDate();
  const gh = date.getHours();
  const gmin = date.getMinutes();

  let jy, jm, jd;
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

  if (gy > 1600) {
    jy = 979;
    gy -= 1600;
  } else {
    jy = 0;
    gy -= 621;
  }

  const gy2 = gm > 2 ? gy + 1 : gy;
  let days =
    365 * gy +
    Math.floor((gy2 + 3) / 4) -
    Math.floor((gy2 + 99) / 100) +
    Math.floor((gy2 + 399) / 400) -
    80 +
    gd +
    g_d_m[gm - 1];

  jy += 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;

  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }

  if (days < 186) {
    jm = 1 + Math.floor(days / 31);
    jd = 1 + (days % 31);
  } else {
    jm = 7 + Math.floor((days - 186) / 30);
    jd = 1 + ((days - 186) % 30);
  }

  const monthNames = [
    "فروردین",
    "اردیبهشت",
    "خرداد",
    "تیر",
    "مرداد",
    "شهریور",
    "مهر",
    "آبان",
    "آذر",
    "دی",
    "بهمن",
    "اسفند",
  ];

  const dayNames = [
    "یکشنبه",
    "دوشنبه",
    "سه‌شنبه",
    "چهارشنبه",
    "پنج‌شنبه",
    "جمعه",
    "شنبه",
  ];
  const dayName = dayNames[date.getDay()];

  return {
    year: jy,
    month: jm,
    day: jd,
    monthName: monthNames[jm - 1],
    dayName: dayName,
    formatted: `${dayName} ${jy}/${String(jm).padStart(2, "0")}/${String(
      jd
    ).padStart(2, "0")} ${String(gh).padStart(2, "0")}:${String(gmin).padStart(
      2,
      "0"
    )}`,
    shortFormat: `${jy}/${String(jm).padStart(2, "0")}/${String(jd).padStart(
      2,
      "0"
    )}`,
  };
}

// Load sent taklif history
function loadSentTaklif() {
  try {
    if (fs.existsSync(SENT_TAKLIF_FILE)) {
      const data = fs.readFileSync(SENT_TAKLIF_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.error("Error loading sent taklif:", error.message);
  }
  return { lastCheck: null, sentMessageIds: [] };
}

// Save sent taklif history
function saveSentTaklif(data) {
  try {
    fs.writeFileSync(SENT_TAKLIF_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (error) {
    console.error("Error saving sent taklif:", error.message);
  }
}

// Fetch homework from website
async function fetchHomework() {
  console.log("🔄 Fetching homework...");

  const jar = new CookieJar();
  const client = wrapper(axios.create({ jar }));

  try {
    const loginPageUrl =
      "https://haftometir.modabberonline.com/Login.aspx?ReturnUrl=%2f&AspxAutoDetectCookieSupport=1";
    const loginPageResponse = await client.get(loginPageUrl);

    const $ = cheerio.load(loginPageResponse.data);

    const formData = new URLSearchParams();
    $('input[type="hidden"]').each((i, elem) => {
      const name = $(elem).attr("name");
      const value = $(elem).attr("value");
      if (name && value) {
        formData.append(name, value);
      }
    });

    formData.append("txtUserName", "0201211971");
    formData.append("txtPassword", "132375");
    formData.append("LoginButton", "ورود به سیستم");

    await client.post(loginPageUrl, formData, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: loginPageUrl,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      maxRedirects: 5,
      validateStatus: () => true,
    });

    const now = new Date();
    const fromDate = new Date(now);
    fromDate.setDate(now.getDate() - 7);
    const toDate = new Date(now);
    toDate.setDate(now.getDate() + 7);

    const apiUrl = `https://haftometir.modabberonline.com/api/CAClassEvent/GetCommonAndAdvancedListClassEventsByCourseRegIdAndDate/0/0/3/0/10/null?fromDate=${fromDate.toISOString()}&toDate=${toDate.toISOString()}`;

    const apiResponse = await client.get(apiUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "application/xml, text/xml, */*",
      },
    });

    const responseText = apiResponse.data;
    const homeworks = [];

    const eventRegex =
      /<StudentClassEventWithAttachments>([\s\S]*?)<\/StudentClassEventWithAttachments>/g;
    let match;

    while ((match = eventRegex.exec(responseText)) !== null) {
      const eventXml = match[1];

      const extractField = (fieldName) => {
        const regex = new RegExp(`<${fieldName}>(.*?)<\/${fieldName}>`, "s");
        const match = eventXml.match(regex);
        return match ? match[1].trim() : "";
      };

      const publishDateRaw = extractField("CreatedDate");
      const deadlineRaw = extractField("Date");

      const homework = {
        subject: extractField("CourseTitle"),
        title: extractField("Title"),
        description: extractField("FinalDescription"),
        publishDate: publishDateRaw
          ? gregorianToJalali(publishDateRaw).formatted
          : "",
        deadline: deadlineRaw ? gregorianToJalali(deadlineRaw).formatted : "",
        serial: extractField("Serial"),
        type: extractField("Type"),
        done: extractField("Done"),
        canUploadAttachment: extractField("StudentCanUploadAttachment"),
        files: [],
      };

      // Extract file attachments
      const filesRegex =
        /<tblCAClassEventsAttachment>([\s\S]*?)<\/tblCAClassEventsAttachment>/g;
      let fileMatch;
      while ((fileMatch = filesRegex.exec(eventXml)) !== null) {
        const fileXml = fileMatch[1];
        const fileNameMatch = fileXml.match(/<FileName>(.*?)<\/FileName>/);
        const extensionMatch = fileXml.match(/<Extension>(.*?)<\/Extension>/);

        if (fileNameMatch) {
          const fileName = fileNameMatch[1].trim();
          const extension = extensionMatch ? extensionMatch[1].trim() : "";
          homework.files.push({
            fileName: fileName,
            extension: extension,
            url: `https://haftometir.modabberonline.com/Files/ClassEvents/${fileName}`,
          });
        }
      }

      // Calculate time remaining
      if (deadlineRaw) {
        const deadlineDate = new Date(deadlineRaw);
        const now = new Date();
        const diffMs = deadlineDate.getTime() - now.getTime();

        if (diffMs > 0) {
          const totalSeconds = Math.floor(diffMs / 1000);
          const totalMinutes = Math.floor(totalSeconds / 60);
          const totalHours = Math.floor(totalMinutes / 60);
          const days = Math.floor(totalHours / 24);

          const hours = totalHours % 24;
          const minutes = totalMinutes % 60;

          homework.timeRemaining = `${days} روز، ${hours} ساعت، ${minutes} دقیقه`;
        } else {
          homework.timeRemaining = "منقضی شده";
        }
      }

      homeworks.push(homework);
    }

    console.log(`✅ Found ${homeworks.length} homework(s)`);
    return homeworks;
  } catch (error) {
    console.error("❌ Error fetching homework:", error.message);
    return [];
  }
}

// Format homework message for Telegram
function formatHomeworkMessage(homework) {
  let message = `📚 *${homework.subject}*\n\n`;
  message += `📝 *عنوان تکلیف:*\n${homework.title}\n\n`;

  if (homework.description) {
    message += `📄 *شرح:*\n${homework.description}\n\n`;
  }

  if (homework.publishDate) {
    message += `📌 *تاریخ انتشار:*\n${homework.publishDate}\n\n`;
  }

  message += `📅 *موعد تحویل:*\n${homework.deadline || "نامشخص"}\n\n`;

  if (homework.timeRemaining) {
    message += `⏰ *زمان باقیمانده:* ${homework.timeRemaining}`;
  }

  return message;
}

// Delete previous messages
async function deletePreviousMessages() {
  const sentData = loadSentTaklif();

  if (sentData.sentMessageIds && sentData.sentMessageIds.length > 0) {
    console.log(
      `🗑️ Deleting ${sentData.sentMessageIds.length} previous messages...`
    );

    for (const messageId of sentData.sentMessageIds) {
      try {
        await bot.deleteMessage(TAKLIF_CHANNEL_ID, messageId);
        console.log(`✅ Deleted message ${messageId}`);
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`❌ Error deleting message ${messageId}:`, error.message);
      }
    }
  }

  // Clear the message IDs
  sentData.sentMessageIds = [];
  saveSentTaklif(sentData);
}

// Send homework to channel
async function sendHomeworkToChannel(homeworks) {
  const sentData = loadSentTaklif();

  if (homeworks.length === 0) {
    console.log("ℹ️ No homework to send");
    return;
  }

  // Delete previous messages first
  await deletePreviousMessages();

  console.log(`📤 Sending ${homeworks.length} homework(s) to channel topic`);

  const newMessageIds = [];

  for (const homework of homeworks) {
    try {
      const message = formatHomeworkMessage(homework);
      const sentMessage = await bot.sendMessage(TAKLIF_CHANNEL_ID, message, {
        parse_mode: "Markdown",
        message_thread_id: TAKLIF_TOPIC_ID,
      });

      newMessageIds.push(sentMessage.message_id);
      console.log(`✅ Sent: ${homework.subject} - ${homework.title}`);

      // Wait a bit after sending message
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Send file attachments if any
      if (homework.files && homework.files.length > 0) {
        for (const file of homework.files) {
          try {
            console.log(`📎 Downloading file: ${file.fileName}`);
            const response = await axios.get(file.url, {
              responseType: "stream",
            });

            // Send the file based on extension
            const extension = file.extension.toLowerCase();
            if (
              ["jpg", "jpeg", "png", "gif", "bmp", "webp"].includes(extension)
            ) {
              const photoMessage = await bot.sendPhoto(
                TAKLIF_CHANNEL_ID,
                response.data,
                {
                  message_thread_id: TAKLIF_TOPIC_ID,
                }
              );
              newMessageIds.push(photoMessage.message_id);
            } else if (
              ["pdf", "doc", "docx", "txt", "zip", "rar"].includes(extension)
            ) {
              const docMessage = await bot.sendDocument(
                TAKLIF_CHANNEL_ID,
                response.data,
                {
                  message_thread_id: TAKLIF_TOPIC_ID,
                },
                {
                  filename: file.fileName,
                }
              );
              newMessageIds.push(docMessage.message_id);
            } else {
              // Default to document for unknown types
              const docMessage = await bot.sendDocument(
                TAKLIF_CHANNEL_ID,
                response.data,
                {
                  message_thread_id: TAKLIF_TOPIC_ID,
                },
                {
                  filename: file.fileName,
                }
              );
              newMessageIds.push(docMessage.message_id);
            }

            console.log(`✅ Sent file: ${file.fileName}`);
            await new Promise((resolve) => setTimeout(resolve, 500));
          } catch (fileError) {
            console.error(
              `❌ Error sending file ${file.fileName}:`,
              fileError.message
            );
          }
        }

        // Wait longer after sending all files before next homework
        await new Promise((resolve) => setTimeout(resolve, 1500));
      } else {
        // Wait 1 second if no files
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error(`❌ Error sending homework:`, error.message);
    }
  }

  sentData.sentMessageIds = newMessageIds;
  sentData.lastCheck = new Date().toISOString();
  saveSentTaklif(sentData);
}

// Check and send new homework
async function checkAndSendHomework() {
  console.log("\n🔍 Checking for new homework...");
  const homeworks = await fetchHomework();

  if (homeworks.length > 0) {
    await sendHomeworkToChannel(homeworks);
  }

  console.log("✅ Check completed\n");
}

// Calculate milliseconds until next 3 PM
function getMillisecondsUntilNextUpdate() {
  const now = new Date();
  const next3PM = new Date();

  next3PM.setHours(DAILY_UPDATE_HOUR, 0, 0, 0);

  // If it's already past 3 PM today, schedule for tomorrow
  if (now >= next3PM) {
    next3PM.setDate(next3PM.getDate() + 1);
  }

  const msUntilNext = next3PM - now;
  console.log(
    `⏰ Next update scheduled at: ${next3PM.toLocaleString("fa-IR")}`
  );

  return msUntilNext;
}

// Schedule daily update
function scheduleDailyUpdate() {
  const msUntilNext = getMillisecondsUntilNextUpdate();

  setTimeout(() => {
    checkAndSendHomework();

    // Schedule next update (24 hours later)
    setInterval(() => {
      checkAndSendHomework();
    }, 24 * 60 * 60 * 1000); // 24 hours
  }, msUntilNext);
}

// ==================== END TAKLIF FUNCTIONS ====================

// Handle /taklif command
bot.onText(/\/taklif/, async (msg) => {
  const chatId = msg.chat.id;
  const messageThreadId = msg.message_thread_id;

  try {
    console.log(`📱 /taklif command received from chat ${chatId}`);

    await bot.sendMessage(chatId, "🔄 در حال دریافت تکالیف...", {
      message_thread_id: messageThreadId,
    });

    const homeworks = await fetchHomework();

    if (homeworks.length === 0) {
      await bot.sendMessage(chatId, "ℹ️ هیچ تکلیفی یافت نشد", {
        message_thread_id: messageThreadId,
      });
      return;
    }

    await bot.sendMessage(
      chatId,
      `📚 ${homeworks.length} تکلیف یافت شد:\n\nدر حال ارسال...`,
      {
        message_thread_id: messageThreadId,
      }
    );

    for (const homework of homeworks) {
      const message = formatHomeworkMessage(homework);
      await bot.sendMessage(chatId, message, {
        parse_mode: "Markdown",
        message_thread_id: messageThreadId,
      });

      // Send file attachments if any
      if (homework.files && homework.files.length > 0) {
        for (const file of homework.files) {
          try {
            console.log(`📎 Downloading file: ${file.fileName}`);
            const response = await axios.get(file.url, {
              responseType: "stream",
            });

            // Send the file based on extension
            const extension = file.extension.toLowerCase();
            if (
              ["jpg", "jpeg", "png", "gif", "bmp", "webp"].includes(extension)
            ) {
              await bot.sendPhoto(chatId, response.data, {
                message_thread_id: messageThreadId,
              });
            } else if (
              ["pdf", "doc", "docx", "txt", "zip", "rar"].includes(extension)
            ) {
              await bot.sendDocument(
                chatId,
                response.data,
                {
                  message_thread_id: messageThreadId,
                },
                {
                  filename: file.fileName,
                }
              );
            } else {
              // Default to document for unknown types
              await bot.sendDocument(
                chatId,
                response.data,
                {
                  message_thread_id: messageThreadId,
                },
                {
                  filename: file.fileName,
                }
              );
            }

            console.log(`✅ Sent file: ${file.fileName}`);
            await new Promise((resolve) => setTimeout(resolve, 500));
          } catch (fileError) {
            console.error(
              `❌ Error sending file ${file.fileName}:`,
              fileError.message
            );
          }
        }
      }

      // Wait 1 second between messages
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    await bot.sendMessage(chatId, "✅ تمام تکالیف ارسال شد", {
      message_thread_id: messageThreadId,
    });
  } catch (error) {
    console.error("❌ Error handling /taklif command:", error.message);
    await bot.sendMessage(
      chatId,
      "❌ خطا در دریافت تکالیف. لطفا دوباره تلاش کنید.",
      {
        message_thread_id: messageThreadId,
      }
    );
  }
});

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
  console.log(`📚 Taklif Bot: Daily updates at ${DAILY_UPDATE_HOUR}:00`);

  // Start taklif scheduler
  scheduleDailyUpdate();
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("Stopping bot...");
  bot.stopPolling();
  process.exit(0);
});
