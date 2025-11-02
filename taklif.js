require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const cheerio = require("cheerio");
const { wrapper } = require("axios-cookiejar-support");
const { CookieJar } = require("tough-cookie");
const fs = require("fs");
const path = require("path");

// Initialize Telegram Bot
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
  polling: true,
});

// Configuration
const TAKLIF_CHANNEL_ID = "-1003221138302"; // Channel ID from URL
const CHECK_INTERVAL = 2 * 60 * 60 * 1000; // 2 hours in milliseconds
const SENT_TAKLIF_FILE = path.join(__dirname, "sent_taklif.json");

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
  return { lastCheck: null, sentSerials: [] };
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
      };

      // Calculate time remaining
      if (deadlineRaw) {
        const deadlineDate = new Date(deadlineRaw);
        const now = new Date();
        const diff = deadlineDate - now;

        if (diff > 0) {
          const days = Math.floor(diff / (1000 * 60 * 60 * 24));
          const hours = Math.floor(
            (diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
          );
          const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
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
  message += `📝 *عنوان:* ${homework.title}\n\n`;

  if (homework.description) {
    message += `📄 *توضیحات:*\n${homework.description}\n\n`;
  }

  message += `📅 *مهلت:* ${homework.deadline || "نامشخص"}\n`;

  if (homework.timeRemaining) {
    message += `⏰ *زمان باقیمانده:* ${homework.timeRemaining}\n`;
  }

  message += `✅ *انجام شده:* ${homework.done === "true" ? "بله" : "خیر"}\n`;

  return message;
}

// Send homework to channel
async function sendHomeworkToChannel(homeworks) {
  const sentData = loadSentTaklif();
  const newHomeworks = homeworks.filter(
    (hw) => !sentData.sentSerials.includes(hw.serial)
  );

  if (newHomeworks.length === 0) {
    console.log("ℹ️ No new homework to send");
    return;
  }

  console.log(`📤 Sending ${newHomeworks.length} new homework(s) to channel`);

  for (const homework of newHomeworks) {
    try {
      const message = formatHomeworkMessage(homework);
      await bot.sendMessage(TAKLIF_CHANNEL_ID, message, {
        parse_mode: "Markdown",
      });

      sentData.sentSerials.push(homework.serial);
      console.log(`✅ Sent: ${homework.subject} - ${homework.title}`);

      // Wait 1 second between messages to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`❌ Error sending homework:`, error.message);
    }
  }

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

// Clean up old sent serials (older than 7 days)
function cleanupOldSerials() {
  const sentData = loadSentTaklif();
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  // Keep only recent serials (this is a simple cleanup, you might want to store timestamps)
  if (sentData.sentSerials.length > 100) {
    sentData.sentSerials = sentData.sentSerials.slice(-50);
    saveSentTaklif(sentData);
    console.log("🧹 Cleaned up old sent serials");
  }
}

// Handle /taklif command
bot.onText(/\/taklif/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    console.log(`📱 /taklif command received from chat ${chatId}`);

    await bot.sendMessage(chatId, "🔄 در حال دریافت تکالیف...");

    const homeworks = await fetchHomework();

    if (homeworks.length === 0) {
      await bot.sendMessage(chatId, "ℹ️ هیچ تکلیفی یافت نشد");
      return;
    }

    await bot.sendMessage(
      chatId,
      `📚 ${homeworks.length} تکلیف یافت شد:\n\nدر حال ارسال...`
    );

    for (const homework of homeworks) {
      const message = formatHomeworkMessage(homework);
      await bot.sendMessage(chatId, message, {
        parse_mode: "Markdown",
      });

      // Wait 1 second between messages
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    await bot.sendMessage(chatId, "✅ تمام تکالیف ارسال شد");
  } catch (error) {
    console.error("❌ Error handling /taklif command:", error.message);
    await bot.sendMessage(
      chatId,
      "❌ خطا در دریافت تکالیف. لطفا دوباره تلاش کنید."
    );
  }
});

// Start periodic checking
console.log("🤖 Taklif Bot Started");
console.log(`📍 Channel ID: ${TAKLIF_CHANNEL_ID}`);
console.log(`⏰ Check interval: Every 2 hours`);

// Initial check
checkAndSendHomework();

// Set up periodic checking every 2 hours
setInterval(() => {
  checkAndSendHomework();
  cleanupOldSerials();
}, CHECK_INTERVAL);

// Handle polling errors
bot.on("polling_error", (error) => {
  if (error.code !== "EFATAL" && error.code !== "ETELEGRAM") {
    console.log("Minor polling error (ignored):", error.code);
  } else {
    console.error("Critical polling error:", error.message);
  }
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("Stopping taklif bot...");
  bot.stopPolling();
  process.exit(0);
});
