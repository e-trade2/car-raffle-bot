require('dotenv').config();
const express = require('express');
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

// Two ways to receive updates from Telegram:
//   - polling: the bot sits in a loop asking Telegram "anything new?" -
//     simple, needs zero public URL, but needs a process running
//     continuously. That's a "Background Worker" on hosts like Render,
//     which usually isn't on the free tier.
//   - webhook: Telegram POSTs updates to us only when something actually
//     happens - this is just an ordinary web server, so it runs as a
//     regular free Web Service instead.
// WEBHOOK_URL being set is what decides which mode to use, so local dev
// (no public URL, and polling "just works" without touching anything)
// stays exactly as simple as before, while a real deployment sets one
// extra env var to switch modes - no code change needed either way.
const useWebhook = !!process.env.WEBHOOK_URL;
if (useWebhook && !/^https:\/\//.test(process.env.WEBHOOK_URL)) {
  throw new Error('WEBHOOK_URL must start with https:// - Telegram requires HTTPS for webhooks');
}

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: !useWebhook });

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

// Error handler (only fires in polling mode - webhook mode has no polling
// loop to error out of; delivery failures there show up as failed webhook
// calls in Telegram's own dashboard instead).
bot.on("polling_error", console.error);

if (useWebhook) {
  const app = express();
  app.use(express.json());

  // The bot token doubles as the secret path segment here - this is
  // Telegram's own recommended pattern (see their webhook docs), since the
  // token is already a secret we're keeping safe, and it means a random
  // POST to some guessed URL can't inject fake updates into the bot.
  const webhookPath = `/telegram-webhook/${process.env.BOT_TOKEN}`;
  app.post(webhookPath, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });

  // Somewhere to point an uptime checker (or just your own browser) to
  // confirm the process is actually up - Telegram never calls this route.
  app.get('/', (req, res) => res.send('Getachew Fikadu Ekub Bot - webhook mode'));

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, async () => {
    try {
      await bot.setWebHook(`${process.env.WEBHOOK_URL}${webhookPath}`);
      console.log(`✅ Getachew Fikadu Ekub Bot is running (webhook mode) on port ${PORT}`);
    } catch (err) {
      // Don't let a failed setWebHook call leave the process silently
      // listening-but-not-actually-registered with Telegram - that's a
      // "why is nothing responding" trap that's hard to spot later.
      console.error('Failed to register webhook with Telegram:', err.message);
      process.exit(1);
    }
  });
} else {
  console.log("✅ Getachew Fikadu Ekub Bot is running (polling mode)...");
}
