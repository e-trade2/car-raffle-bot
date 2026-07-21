require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

if (!process.env.BOT_TOKEN) {
  throw new Error('BOT_TOKEN is missing in .env');
}
if (!process.env.MINI_APP_URL) {
  // Not just a "nice to have" - the whole point of this bot is the button
  // that opens the Mini App. Telegram rejects a web_app button with an
  // empty/undefined url, which would otherwise only surface later as a
  // failed sendMessage the first time someone shares their contact.
  throw new Error('MINI_APP_URL is missing in .env - see .env.example');
}
if (!/^https:\/\//.test(process.env.MINI_APP_URL)) {
  // Telegram Mini Apps require HTTPS - catching this at startup is a much
  // clearer failure than "the app button silently does nothing" once a
  // real user taps it.
  throw new Error('MINI_APP_URL must start with https:// - Telegram requires HTTPS for Mini Apps');
}

if (!process.env.RAFFLE_APP_URL || !process.env.INTERNAL_API_KEY) {
  // Not fatal - the bot still runs fine without this - but silent
  // otherwise, which is exactly how this gets missed: someone shares their
  // contact, the bot confirms it, and the Mini App profile just never
  // shows a phone number, with no error anywhere to explain why. Mirrors
  // the equivalent startup warning on the raffle app's own server for the
  // same two variables.
  console.warn('⚠️  RAFFLE_APP_URL and/or INTERNAL_API_KEY not set in .env - shared contacts will NOT be linked to the Mini App profile (the bot will still work otherwise). See .env.example.');
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
    om: "✅ Lakkoofsi bilbilaa keessan mirkanaa'eera.",
    am: "✅ የስልክ ቁጥርዎ ተቀብሏል።",
    en: "✅ Phone number confirmed."
  },

  // Text shown above the "open app" button. Deliberately different from the
  // button label below - the button already restates the app name, so
  // repeating it in the message text just prints the same line twice.
  openAppPrompt: {
    om: "👇 Tuqaa gadii app banuuf.",
    am: "👇 መተግበሪያውን ለመክፈት ከታች ይጫኑ።",
    en: "👇 Tap below to open the app.",
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
  ).catch(err => console.error('/start handler failed:', err.message));
});

// LANGUAGE
bot.on("callback_query", async (query) => {
  if (!query.data.startsWith("lang_")) return;

  const chatId = query.message.chat.id;
  const lang = query.data.replace("lang_", "");

  try {
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
  } catch (err) {
    // A single failed Telegram API call here (network blip, user blocked
    // the bot mid-flow, etc.) must not take down the whole bot process -
    // an unhandled rejection inside an event handler crashes the entire
    // long-polling loop for every other user too, in modern Node.
    console.error('callback_query handler failed:', err.message);
  }
});

// CONTACT
bot.on("contact", async (msg) => {

  const chatId = msg.chat.id;
  const lang = userLang.get(chatId) || "en";

  try {
    // User must send his own contact
    if (msg.contact.user_id !== msg.from.id) {
      return await bot.sendMessage(chatId, TEXT.ownPhoneOnly[lang]);
    }

    const phone = msg.contact.phone_number;
    const fullName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ');

    console.log({
      telegramId: msg.from.id,
      name: fullName,
      username: msg.from.username,
      phone,
      language: lang
    });

    // Hand the phone/name off to the raffle app so the Mini App can prefill
    // checkout instead of asking the user to retype what they just gave the
    // bot. Guarded on RAFFLE_APP_URL/INTERNAL_API_KEY being set so this is
    // opt-in - if they're not configured, the bot still works fine, the
    // Mini App just won't be able to prefill anything.
    if (process.env.RAFFLE_APP_URL && process.env.INTERNAL_API_KEY) {
      try {
        const res = await fetch(`${process.env.RAFFLE_APP_URL}/api/telegram/link`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-key': process.env.INTERNAL_API_KEY
          },
          body: JSON.stringify({ telegramId: msg.from.id, phone, fullName })
        });
        if (!res.ok) {
          console.error('telegram/link failed:', res.status, await res.text());
        }
      } catch (err) {
        // Don't let a raffle-app outage break the bot's own conversation flow.
        console.error('telegram/link request failed:', err.message);
      }
    }

    await bot.sendMessage(chatId, TEXT.phoneConfirmed[lang], {
      reply_markup: {
        remove_keyboard: true
      }
    });

    await bot.sendMessage(chatId, TEXT.openAppPrompt[lang], {
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
  } catch (err) {
    // Same reasoning as the callback_query handler above - a failed
    // sendMessage (e.g. the user blocked the bot right after sharing their
    // contact) must not crash the whole bot process for every other user.
    console.error('contact handler failed:', err.message);
  }
});

// Error handler
bot.on("polling_error", console.error);

console.log("✅ Getachew Fikadu Ekub Bot is running...");