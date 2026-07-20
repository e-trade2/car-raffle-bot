require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

if (!process.env.BOT_TOKEN) {
  throw new Error('BOT_TOKEN is missing in .env');
}

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// Store user language (temporary; replace with database later)
const userLang = new Map();

const TEXT = {
  welcome: "🚗 *Getachew Fikadu Jirata*\n\nBaga gara *Bot* keenyaa dhuftan.\nወደ *Bot*ችን እንኳን በደህና መጡ።\nWelcome to our *Bot*.",

  chooseLang: "Maaloo Afaan filadhaa.\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\nእባክዎ ቋንቋ ይምረጡ።\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\nPlease select your language.",

  askPhone: {
    om: "Lakkoofsa bilbilaa kee qoodi.",
    am: "እባክዎ ስልክ ቁጥርዎን ያጋሩ።",
    en: "Please share your phone number."
  },

  sharePhone: {
    om: "📱 Lakkoofsa Bilbilaa Qoodi",
    am: "📱 ስልኬን አጋራ",
    en: "📱 Share my phone"
  },

  phoneConfirmed: {
    om: "✅ Lakkoofsi bilbilaa keessan mirkanaa'eera.\nApp banaachuuf button armaan gadii tuqi.",
    am: "✅ የስልክ ቁጥርዎ ተቀብሏል።\nመተግበሪያውን ለመክፈት ከታች ያለውን ቁልፍ ይጫኑ።",
    en: "✅ Phone number confirmed.\nTap the button below to open the app."
  },

  openApp: {
    om: "🚗 Getachew Fikadu app",
    am: "🚗 ጌታቸው ፍቃዱ መተግበሪያ",
    en: "🚗 Getachew Fikadu app",
  },

  ownPhoneOnly: {
    om: "Maaloo lakkoofsa kee qofa qoodi.",
    am: "እባክዎ የራስዎን ስልክ ቁጥር ብቻ ያጋሩ።",
    en: "Please share your own phone number."
  }
};

// START
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `${TEXT.welcome}\n\n${TEXT.chooseLang}`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🇪🇹 Afaan Oromo", callback_data: "lang_om" }],
          [{ text: "🇪🇹 አማርኛ", callback_data: "lang_am" }],
          [{ text: "🇬🇧 English", callback_data: "lang_en" }]
        ]
      }
    }
  );
});

// LANGUAGE
bot.on("callback_query", async (query) => {

  if (!query.data.startsWith("lang_")) return;

  const chatId = query.message.chat.id;
  const lang = query.data.replace("lang_", "");

  userLang.set(chatId, lang);

  await bot.answerCallbackQuery(query.id);

  await bot.sendMessage(chatId, TEXT.askPhone[lang], {
    reply_markup: {
      keyboard: [
        [
          {
            text: TEXT.sharePhone[lang],
            request_contact: true
          }
        ]
      ],
      resize_keyboard: true,
      one_time_keyboard: true
    }
  });
});

// CONTACT
bot.on("contact", async (msg) => {

  const chatId = msg.chat.id;
  const lang = userLang.get(chatId) || "en";

  // User must send his own contact
  if (msg.contact.user_id !== msg.from.id) {
    return bot.sendMessage(chatId, TEXT.ownPhoneOnly[lang]);
  }

  const phone = msg.contact.phone_number;

  console.log({
    telegramId: msg.from.id,
    name: msg.from.first_name,
    username: msg.from.username,
    phone,
    language: lang
  });

  // TODO:
  // Save to Supabase here

  await bot.sendMessage(chatId, TEXT.phoneConfirmed[lang], {
    reply_markup: {
      remove_keyboard: true
    }
  });

  await bot.sendMessage(chatId, TEXT.openApp[lang], {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: TEXT.openApp[lang],
            web_app: {
              url: process.env.MINI_APP_URL
            }
          }
        ]
      ]
    }
  });
});

// Error handler
bot.on("polling_error", console.error);

console.log("✅ Getachew Fikadu Ekub Bot is running...");