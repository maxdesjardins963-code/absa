/**
 * ========================================================
 *   WESTJET MILES BOT - index.js (discord.js v14)
 *   Version variables d'environnement (Render / JustRunMyApp.com)
 * ========================================================
 *
 * Ce script lit sa configuration depuis les variables d'environnement
 * (section "Environment" de ton hébergeur) :
 *   - TOKEN           -> Bot Token
 *   - CLIENT_ID       -> Application ID
 *   - GUILD_ID        -> ID de ton serveur WestJet
 *   - STAFF_ROLE_ID   -> ID du rôle autorisé à gérer les codes/miles
 *
 * La plupart des hébergeurs (Render, JustRunMyApp, Railway, etc.)
 * n'offrent pas de console interactive où on peut taper une réponse :
 * seules les variables d'environnement fonctionnent de façon fiable.
 *
 * Les commandes slash sont enregistrées automatiquement sur ton
 * serveur (GUILD_ID) à chaque démarrage.
 *
 * ========================================================
 *   INSTALLATION
 * ========================================================
 * 1. Build Command  : npm install
 * 2. Start Command  : node index.js
 * 3. Environment    : ajoute TOKEN, CLIENT_ID, GUILD_ID, STAFF_ROLE_ID
 * ========================================================
 */

const {
  Client,
  GatewayIntentBits,
  Events,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder,
  PermissionFlagsBits,
  MessageFlags,
  REST,
  Routes,
  SlashCommandBuilder,
} = require("discord.js");
const fs = require("fs");
const path = require("path");
const http = require("http");

// ============== SERVEUR HTTP FACTICE (pour Render) ==============
// Render s'attend à ce qu'un "Web Service" écoute sur un port. Un bot
// Discord n'en a pas besoin, donc on ouvre juste un petit serveur qui
// répond "OK" pour que Render arrête de chercher un port et considère
// le déploiement comme réussi.
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("WestJet Miles Bot is running.");
  })
  .listen(PORT, () => {
    console.log(`🌐 Dummy HTTP server listening on port ${PORT} (for Render)`);
  });

// ============== CHEMINS DE STOCKAGE ==============
const DATA_DIR = path.join(__dirname, "data");
const MILES_FILE = path.join(DATA_DIR, "miles.json");
const CODES_FILE = path.join(DATA_DIR, "codes.json");
const MAX_CODES_PER_GENERATION = 1000;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return {};
  }
}

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

// ============== CONFIGURATION (variables d'environnement) ==============
function loadConfig() {
  const TOKEN = process.env.TOKEN;
  const CLIENT_ID = process.env.CLIENT_ID;
  const GUILD_ID = process.env.GUILD_ID;
  const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID;

  const missing = [];
  if (!TOKEN) missing.push("TOKEN");
  if (!CLIENT_ID) missing.push("CLIENT_ID");
  if (!GUILD_ID) missing.push("GUILD_ID");
  if (!STAFF_ROLE_ID) missing.push("STAFF_ROLE_ID");

  if (missing.length > 0) {
    console.error("========================================");
    console.error("❌ Variables d'environnement manquantes :");
    missing.forEach((m) => console.error(`   - ${m}`));
    console.error("");
    console.error("Va dans la section 'Environment' de ton hébergeur et ajoute :");
    console.error("   TOKEN=ton_bot_token");
    console.error("   CLIENT_ID=ton_application_id");
    console.error("   GUILD_ID=ton_guild_id");
    console.error("   STAFF_ROLE_ID=ton_staff_role_id");
    console.error("========================================");
    process.exit(1);
  }

  return { TOKEN, CLIENT_ID, GUILD_ID, STAFF_ROLE_ID };
}

// ============== FONCTIONS MILES / CODES ==============
function getMiles(userId) {
  const miles = loadJson(MILES_FILE);
  return miles[userId] || 0;
}

function addMiles(userId, amount) {
  const miles = loadJson(MILES_FILE);
  miles[userId] = (miles[userId] || 0) + amount;
  saveJson(MILES_FILE, miles);
  return miles[userId];
}

function generateUniqueCode(existingCodes) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code;
  do {
    let random = "";
    for (let i = 0; i < 8; i++) {
      random += chars[Math.floor(Math.random() * chars.length)];
    }
    code = `WJ-${random}`;
  } while (existingCodes.has(code));
  return code;
}

function isStaff(interaction, STAFF_ROLE_ID) {
  if (interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return true;
  }
  return interaction.member.roles.cache.has(STAFF_ROLE_ID);
}

function buildPanelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("westjet_check_miles")
      .setLabel("Check Your Miles")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("westjet_redeem_miles")
      .setLabel("Redeem Miles")
      .setStyle(ButtonStyle.Primary)
  );
}

// ============== DÉPLOIEMENT DES SLASH COMMANDS ==============
async function deployCommands(TOKEN, CLIENT_ID, GUILD_ID) {
  const commands = [
    new SlashCommandBuilder()
      .setName("panel")
      .setDescription("Post the WestJet miles panel (staff only)"),

    new SlashCommandBuilder()
      .setName("generatecodes")
      .setDescription("Generate redeemable miles codes (staff only)")
      .addIntegerOption((opt) =>
        opt.setName("amount").setDescription("How many codes to generate (max 1000)").setRequired(true)
      )
      .addIntegerOption((opt) =>
        opt.setName("miles").setDescription("How many miles each code is worth").setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("addmiles")
      .setDescription("Manually add miles to a member (staff only)")
      .addUserOption((opt) => opt.setName("user").setDescription("The member to add miles to").setRequired(true))
      .addIntegerOption((opt) => opt.setName("amount").setDescription("How many miles to add").setRequired(true)),

    new SlashCommandBuilder()
      .setName("removemiles")
      .setDescription("Manually remove miles from a member (staff only)")
      .addUserOption((opt) => opt.setName("user").setDescription("The member to remove miles from").setRequired(true))
      .addIntegerOption((opt) => opt.setName("amount").setDescription("How many miles to remove").setRequired(true)),

    new SlashCommandBuilder()
      .setName("codestats")
      .setDescription("See how many codes are left / used (staff only)"),

    new SlashCommandBuilder().setName("mymiles").setDescription("Check your own miles balance"),
  ].map((cmd) => cmd.toJSON());

  const rest = new REST({ version: "10" }).setToken(TOKEN);

  console.log("⏳ Déploiement des slash commands...");
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log("✅ Slash commands déployées sur ton serveur (instantané).\n");
}

// ============== DÉMARRAGE ==============
(async () => {
  const { TOKEN, CLIENT_ID, GUILD_ID, STAFF_ROLE_ID } = loadConfig();

  try {
    await deployCommands(TOKEN, CLIENT_ID, GUILD_ID);
  } catch (err) {
    console.error("❌ Erreur lors du déploiement des commandes :", err.message);
    console.error(
      "Vérifie que TOKEN et Application ID sont corrects, et que le bot a bien été invité avec le scope 'applications.commands'."
    );
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  });

  client.once(Events.ClientReady, (c) => {
    console.log(`✅ Logged in as ${c.user.tag} - WestJet Miles Bot ready.`);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      // ---------- SLASH COMMANDS ----------
      if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        if (commandName === "panel") {
          if (!isStaff(interaction, STAFF_ROLE_ID)) {
            return interaction.reply({ content: "❌ You don't have permission to use this command.", flags: MessageFlags.Ephemeral });
          }

          const embed = new EmbedBuilder()
            .setTitle("WestJet Miles Program")
            .setDescription(
              "Track your miles and redeem codes below.\n\n" +
                "**Check Your Miles** — view your current balance\n" +
                "**Redeem Miles** — enter a code to add miles to your account"
            )
            .setColor(0x1abc9c)
            .setFooter({ text: "WestJet | Miles Program" });

          await interaction.channel.send({ embeds: [embed], components: [buildPanelRow()] });
          return interaction.reply({ content: "✅ Panel posted.", flags: MessageFlags.Ephemeral });
        }

        if (commandName === "generatecodes") {
          if (!isStaff(interaction, STAFF_ROLE_ID)) {
            return interaction.reply({ content: "❌ You don't have permission to use this command.", flags: MessageFlags.Ephemeral });
          }

          const amount = interaction.options.getInteger("amount");
          const milesValue = interaction.options.getInteger("miles");

          if (amount <= 0 || amount > MAX_CODES_PER_GENERATION) {
            return interaction.reply({
              content: `❌ Amount must be between 1 and ${MAX_CODES_PER_GENERATION}.`,
              flags: MessageFlags.Ephemeral,
            });
          }
          if (milesValue <= 0) {
            return interaction.reply({ content: "❌ Miles value must be greater than 0.", flags: MessageFlags.Ephemeral });
          }

          await interaction.deferReply({ flags: MessageFlags.Ephemeral });

          const codes = loadJson(CODES_FILE);
          const existingCodes = new Set(Object.keys(codes));
          const newCodes = [];

          for (let i = 0; i < amount; i++) {
            const code = generateUniqueCode(existingCodes);
            existingCodes.add(code);
            codes[code] = {
              miles: milesValue,
              used: false,
              createdBy: interaction.user.id,
              createdAt: new Date().toISOString(),
            };
            newCodes.push(code);
          }

          saveJson(CODES_FILE, codes);

          const fileContent = newCodes.join("\n");
          const attachment = new AttachmentBuilder(Buffer.from(fileContent, "utf-8"), {
            name: `westjet_codes_${milesValue}miles_${amount}codes.txt`,
          });

          return interaction.editReply({
            content:
              `✅ Generated **${amount} codes**, each worth **${milesValue} miles**.\n` +
              `Total codes in system: **${Object.keys(codes).length}**.\n` +
              `Distribute these to staff for in-flight redemption.`,
            files: [attachment],
          });
        }

        if (commandName === "addmiles") {
          if (!isStaff(interaction, STAFF_ROLE_ID)) {
            return interaction.reply({ content: "❌ You don't have permission to use this command.", flags: MessageFlags.Ephemeral });
          }
          const user = interaction.options.getUser("user");
          const amount = interaction.options.getInteger("amount");

          if (amount <= 0) {
            return interaction.reply({ content: "❌ Amount must be greater than 0.", flags: MessageFlags.Ephemeral });
          }

          const newTotal = addMiles(user.id, amount);
          return interaction.reply({
            content: `✅ Added **${amount} miles** to <@${user.id}>. New balance: **${newTotal} miles**.`,
            flags: MessageFlags.Ephemeral,
          });
        }

        if (commandName === "removemiles") {
          if (!isStaff(interaction, STAFF_ROLE_ID)) {
            return interaction.reply({ content: "❌ You don't have permission to use this command.", flags: MessageFlags.Ephemeral });
          }
          const user = interaction.options.getUser("user");
          const amount = interaction.options.getInteger("amount");

          if (amount <= 0) {
            return interaction.reply({ content: "❌ Amount must be greater than 0.", flags: MessageFlags.Ephemeral });
          }

          let newTotal = addMiles(user.id, -amount);
          if (newTotal < 0) {
            newTotal = 0;
            const miles = loadJson(MILES_FILE);
            miles[user.id] = 0;
            saveJson(MILES_FILE, miles);
          }

          return interaction.reply({
            content: `✅ Removed **${amount} miles** from <@${user.id}>. New balance: **${newTotal} miles**.`,
            flags: MessageFlags.Ephemeral,
          });
        }

        if (commandName === "codestats") {
          if (!isStaff(interaction, STAFF_ROLE_ID)) {
            return interaction.reply({ content: "❌ You don't have permission to use this command.", flags: MessageFlags.Ephemeral });
          }
          const codes = loadJson(CODES_FILE);
          const total = Object.keys(codes).length;
          const used = Object.values(codes).filter((c) => c.used).length;
          const remaining = total - used;

          return interaction.reply({
            content: `📊 **Code Stats**\nTotal: ${total}\nUsed: ${used}\nRemaining: ${remaining}`,
            flags: MessageFlags.Ephemeral,
          });
        }

        if (commandName === "mymiles") {
          const balance = getMiles(interaction.user.id);
          return interaction.reply({ content: `✈️ You currently have **${balance} miles**.`, flags: MessageFlags.Ephemeral });
        }
      }

      // ---------- BOUTONS ----------
      if (interaction.isButton()) {
        if (interaction.customId === "westjet_check_miles") {
          const balance = getMiles(interaction.user.id);
          return interaction.reply({ content: `✈️ You currently have **${balance} miles**.`, flags: MessageFlags.Ephemeral });
        }

        if (interaction.customId === "westjet_redeem_miles") {
          const modal = new ModalBuilder().setCustomId("westjet_redeem_modal").setTitle("Redeem Miles Code");

          const codeInput = new TextInputBuilder()
            .setCustomId("code_input")
            .setLabel("Enter your code")
            .setPlaceholder("WJ-XXXXXXXX")
            .setStyle(TextInputStyle.Short)
            .setMinLength(3)
            .setMaxLength(32)
            .setRequired(true);

          modal.addComponents(new ActionRowBuilder().addComponents(codeInput));
          return interaction.showModal(modal);
        }
      }

      // ---------- MODAL SUBMIT ----------
      if (interaction.isModalSubmit() && interaction.customId === "westjet_redeem_modal") {
        const enteredCode = interaction.fields.getTextInputValue("code_input").trim().toUpperCase();
        const codes = loadJson(CODES_FILE);

        if (!codes[enteredCode]) {
          return interaction.reply({ content: "❌ This code is invalid.", flags: MessageFlags.Ephemeral });
        }

        const codeData = codes[enteredCode];
        if (codeData.used) {
          return interaction.reply({ content: "⚠️ This code has already been redeemed.", flags: MessageFlags.Ephemeral });
        }

        const milesValue = codeData.miles || 0;
        const newTotal = addMiles(interaction.user.id, milesValue);

        codes[enteredCode].used = true;
        codes[enteredCode].redeemedBy = interaction.user.id;
        codes[enteredCode].redeemedAt = new Date().toISOString();
        saveJson(CODES_FILE, codes);

        return interaction.reply({
          content:
            `✅ Code redeemed successfully!\n` +
            `You received **${milesValue} miles**.\n` +
            `Your new balance: **${newTotal} miles**.`,
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (err) {
      console.error(err);
      if (interaction.isRepliable()) {
        const errorPayload = { content: "❌ An error occurred.", flags: MessageFlags.Ephemeral };
        if (interaction.deferred || interaction.replied) {
          interaction.editReply(errorPayload).catch(() => {});
        } else {
          interaction.reply(errorPayload).catch(() => {});
        }
      }
    }
  });

  client.login(TOKEN);
})();
// ====== WESTJET MILES SHOP (colle ça tout en bas de ton index.js, à la place de require("./shop.js")) ======
(() => {
// WestJet Miles Shop
// Deuxième bot (son propre token) qui tourne dans le même process que le bot Miles.
// Il lit et écrit dans data/miles.json, donc les miles restent les mêmes partout.

const {
  Client,
  GatewayIntentBits,
  Events,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  PermissionFlagsBits,
  MessageFlags,
  REST,
  Routes,
  SlashCommandBuilder,
} = require("discord.js");
const fs = require("fs");
const path = require("path");

const TOKEN = process.env.SHOP_TOKEN;
const CLIENT_ID = process.env.SHOP_CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID;
const LOG_CHANNEL_ID = process.env.SHOP_LOG_CHANNEL_ID;

// si les variables du shop ne sont pas là, on ne fait rien
if (!TOKEN || !CLIENT_ID || !GUILD_ID) return;

// ---------- ce qu'on vend (change les prix ici) ----------
const ITEMS = {
  premium: { name: "Premium Economy", price: 6000 },
  business: { name: "Business Class", price: 12500 },
  first: { name: "First Class", price: 25000 },
};

// statut selon le total de miles gagnés, avec un rabais sur les prix
const TIERS = [
  { name: "Platinum", min: 30000, off: 0.15 },
  { name: "Gold", min: 15000, off: 0.1 },
  { name: "Silver", min: 5000, off: 0.05 },
  { name: "Member", min: 0, off: 0 },
];

// ---------- fichiers ----------
const DATA_DIR = path.join(__dirname, "data");
const MILES_FILE = path.join(DATA_DIR, "miles.json");
const FLIGHTS_FILE = path.join(DATA_DIR, "flights.json");
const SHOP_FILE = path.join(DATA_DIR, "shop.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function read(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}

function write(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
}

const getMiles = (id) => read(MILES_FILE, {})[id] || 0;
const getFlights = () => read(FLIGHTS_FILE, []);
const getShop = () => {
  const s = read(SHOP_FILE, {});
  return { spent: s.spent || {}, orders: s.orders || [] };
};

// miles gagnés au total = solde actuel + ce qui a été dépensé dans le shop
function getEarned(id) {
  return getMiles(id) + (getShop().spent[id] || 0);
}

const getTier = (earned) => TIERS.find((t) => earned >= t.min);
const priceFor = (item, earned) => Math.round(item.price * (1 - getTier(earned).off));
const fmt = (n) => n.toLocaleString("en-US");

function isStaff(i) {
  if (i.member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return STAFF_ROLE_ID ? i.member.roles.cache.has(STAFF_ROLE_ID) : false;
}

// ---------- affichage ----------
function shopView(userId) {
  const balance = getMiles(userId);
  const earned = getEarned(userId);
  const tier = getTier(earned);

  const embed = new EmbedBuilder()
    .setTitle("WestJet Miles Shop")
    .setColor(0x1abc9c)
    .setDescription(
      `Balance: **${fmt(balance)} miles**\nStatus: **${tier.name}**` +
        (tier.off ? ` (${Math.round(tier.off * 100)}% off)` : "")
    )
    .addFields(
      Object.values(ITEMS).map((it) => ({
        name: it.name,
        value: `${fmt(priceFor(it, earned))} miles`,
        inline: true,
      }))
    )
    .setFooter({ text: "WestJet | Miles Shop" });

  const menu = new StringSelectMenuBuilder()
    .setCustomId("ms_pick")
    .setPlaceholder("Pick a class")
    .addOptions(
      Object.entries(ITEMS).map(([key, it]) => ({
        label: it.name,
        description: `${fmt(priceFor(it, earned))} miles`,
        value: key,
      }))
    );

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
}

function statusText(userId) {
  const balance = getMiles(userId);
  const earned = getEarned(userId);
  const tier = getTier(earned);
  const next = [...TIERS].reverse().find((t) => t.min > earned);
  let txt = `You have **${fmt(balance)} miles**.\nStatus: **${tier.name}**`;
  if (tier.off) txt += ` (${Math.round(tier.off * 100)}% off the shop)`;
  if (next) txt += `\n${fmt(next.min - earned)} more miles to reach **${next.name}**.`;
  return txt;
}

// choix en cours pour chaque membre
const pending = new Map();
const TEN_MIN = 10 * 60 * 1000;

function getPending(userId) {
  const p = pending.get(userId);
  if (!p || Date.now() - p.ts > TEN_MIN) {
    pending.delete(userId);
    return null;
  }
  return p;
}

const eph = MessageFlags.Ephemeral;

// ---------- commandes slash ----------
async function deploy() {
  const commands = [
    new SlashCommandBuilder().setName("shop").setDescription("Open the miles shop"),
    new SlashCommandBuilder().setName("status").setDescription("See your miles and your status"),
    new SlashCommandBuilder().setName("shoppanel").setDescription("Post the shop panel (staff only)"),
    new SlashCommandBuilder()
      .setName("addflight")
      .setDescription("Add an event flight to the list (staff only)")
      .addStringOption((o) =>
        o.setName("name").setDescription("Example: QS 2210 YUL-CDG").setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName("delflight")
      .setDescription("Remove an event flight from the list (staff only)")
      .addStringOption((o) =>
        o.setName("name").setDescription("Exact name of the flight").setRequired(true)
      ),
  ].map((c) => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
}

// ---------- bot ----------
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, () => {
  deploy().catch(() => {});
});

client.on(Events.InteractionCreate, async (i) => {
  try {
    // ----- slash -----
    if (i.isChatInputCommand()) {
      if (i.commandName === "shop") {
        return i.reply({ ...shopView(i.user.id), flags: eph });
      }

      if (i.commandName === "status") {
        return i.reply({ content: statusText(i.user.id), flags: eph });
      }

      if (i.commandName === "shoppanel") {
        if (!isStaff(i)) return i.reply({ content: "You can't use this.", flags: eph });

        const embed = new EmbedBuilder()
          .setTitle("WestJet Miles Shop")
          .setColor(0x1abc9c)
          .setDescription(
            "Spend your miles on an upgrade for one of our event flights.\n\n" +
              Object.values(ITEMS)
                .map((it) => `**${it.name}**: ${fmt(it.price)} miles`)
                .join("\n") +
              "\n\nHigher status means cheaper upgrades."
          )
          .setFooter({ text: "WestJet | Miles Shop" });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("ms_open").setLabel("Open Shop").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId("ms_status").setLabel("My Status").setStyle(ButtonStyle.Secondary)
        );

        await i.channel.send({ embeds: [embed], components: [row] });
        return i.reply({ content: "Panel posted.", flags: eph });
      }

      if (i.commandName === "addflight") {
        if (!isStaff(i)) return i.reply({ content: "You can't use this.", flags: eph });
        const name = i.options.getString("name").trim().slice(0, 90);
        const list = getFlights();
        if (list.length >= 25) {
          return i.reply({ content: "The list is full (25 flights max).", flags: eph });
        }
        if (list.includes(name)) {
          return i.reply({ content: "That flight is already in the list.", flags: eph });
        }
        list.push(name);
        write(FLIGHTS_FILE, list);
        return i.reply({ content: `Added **${name}**.`, flags: eph });
      }

      if (i.commandName === "delflight") {
        if (!isStaff(i)) return i.reply({ content: "You can't use this.", flags: eph });
        const name = i.options.getString("name").trim();
        const list = getFlights();
        if (!list.includes(name)) {
          return i.reply({ content: "Flight not found, check the exact name.", flags: eph });
        }
        write(FLIGHTS_FILE, list.filter((f) => f !== name));
        return i.reply({ content: `Removed **${name}**.`, flags: eph });
      }
    }

    // ----- boutons du panel -----
    if (i.isButton() && i.customId === "ms_open") {
      return i.reply({ ...shopView(i.user.id), flags: eph });
    }

    if (i.isButton() && i.customId === "ms_status") {
      return i.reply({ content: statusText(i.user.id), flags: eph });
    }

    // ----- 1. classe choisie, on demande le nom Roblox -----
    if (i.isStringSelectMenu() && i.customId === "ms_pick") {
      const key = i.values[0];
      const item = ITEMS[key];
      if (!item) return;

      const cost = priceFor(item, getEarned(i.user.id));
      const balance = getMiles(i.user.id);
      if (balance < cost) {
        return i.reply({
          content: `You need ${fmt(cost - balance)} more miles for ${item.name}.`,
          flags: eph,
        });
      }

      pending.set(i.user.id, { key, ts: Date.now() });

      const modal = new ModalBuilder().setCustomId("ms_roblox").setTitle("Your Roblox account");
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("roblox_name")
            .setLabel("What's your Roblox username?")
            .setStyle(TextInputStyle.Short)
            .setMinLength(3)
            .setMaxLength(20)
            .setRequired(true)
        )
      );
      return i.showModal(modal);
    }

    // ----- 2. nom Roblox reçu, on choisit le vol event -----
    if (i.isModalSubmit() && i.customId === "ms_roblox") {
      const p = getPending(i.user.id);
      if (!p) return i.reply({ content: "That took too long, use /shop again.", flags: eph });

      const roblox = i.fields.getTextInputValue("roblox_name").trim();
      if (!/^[A-Za-z0-9_]{3,20}$/.test(roblox)) {
        return i.reply({
          content: "That doesn't look like a Roblox username. Try again from /shop.",
          flags: eph,
        });
      }
      p.roblox = roblox;

      const flights = getFlights();
      if (flights.length === 0) {
        return i.reply({ content: "There are no event flights open right now.", flags: eph });
      }

      const menu = new StringSelectMenuBuilder()
        .setCustomId("ms_flight")
        .setPlaceholder("Pick the event flight")
        .addOptions(flights.map((f) => ({ label: f, value: f })));

      return i.reply({
        content: "Which event flight is this upgrade for?",
        components: [new ActionRowBuilder().addComponents(menu)],
        flags: eph,
      });
    }

    // ----- 3. vol choisi, confirmation -----
    if (i.isStringSelectMenu() && i.customId === "ms_flight") {
      const p = getPending(i.user.id);
      if (!p) return i.update({ content: "That took too long, use /shop again.", components: [] });

      p.flight = i.values[0];
      const cost = priceFor(ITEMS[p.key], getEarned(i.user.id));

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("ms_yes").setLabel("Confirm").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("ms_no").setLabel("Cancel").setStyle(ButtonStyle.Secondary)
      );

      return i.update({
        content:
          `**${ITEMS[p.key].name}** on **${p.flight}**\n` +
          `Roblox: **${p.roblox}**\n` +
          `Price: **${fmt(cost)} miles**`,
        components: [row],
      });
    }

    // ----- 4. confirmation finale -----
    if (i.isButton() && i.customId === "ms_no") {
      pending.delete(i.user.id);
      return i.update({ content: "Purchase cancelled.", components: [] });
    }

    if (i.isButton() && i.customId === "ms_yes") {
      const p = getPending(i.user.id);
      if (!p || !p.flight || !p.roblox) {
        return i.update({ content: "That took too long, use /shop again.", components: [] });
      }
      pending.delete(i.user.id);

      const item = ITEMS[p.key];
      const cost = priceFor(item, getEarned(i.user.id));

      const miles = read(MILES_FILE, {});
      if ((miles[i.user.id] || 0) < cost) {
        return i.update({ content: "You don't have enough miles anymore.", components: [] });
      }
      miles[i.user.id] -= cost;
      write(MILES_FILE, miles);

      const shop = getShop();
      shop.spent[i.user.id] = (shop.spent[i.user.id] || 0) + cost;
      const orderId = Date.now().toString(36).toUpperCase();
      shop.orders.push({
        id: orderId,
        user: i.user.id,
        roblox: p.roblox,
        item: item.name,
        flight: p.flight,
        cost,
        at: new Date().toISOString(),
      });
      write(SHOP_FILE, shop);

      if (LOG_CHANNEL_ID) {
        const channel = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
        if (channel) {
          const embed = new EmbedBuilder()
            .setTitle("New upgrade purchase")
            .setColor(0xf1c40f)
            .addFields(
              { name: "Member", value: `<@${i.user.id}>`, inline: true },
              { name: "Roblox", value: p.roblox, inline: true },
              { name: "Class", value: item.name, inline: true },
              { name: "Flight", value: p.flight, inline: true },
              { name: "Paid", value: `${fmt(cost)} miles`, inline: true },
              { name: "Order", value: orderId, inline: true }
            )
            .setTimestamp();
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`ms_done_${orderId}`)
              .setLabel("Mark as done")
              .setStyle(ButtonStyle.Success)
          );
          await channel.send({ embeds: [embed], components: [row] }).catch(() => {});
        }
      }

      return i.update({
        content:
          `Done! Your **${item.name}** on **${p.flight}** is booked for **${p.roblox}**.\n` +
          `Remaining balance: **${fmt(miles[i.user.id])} miles**. Staff will set it up for you.`,
        components: [],
      });
    }

    // ----- staff: commande traitée -----
    if (i.isButton() && i.customId.startsWith("ms_done_")) {
      if (!isStaff(i)) return i.reply({ content: "You can't use this.", flags: eph });
      const embed = EmbedBuilder.from(i.message.embeds[0])
        .setColor(0x2ecc71)
        .setFooter({ text: `Handled by ${i.user.username}` });
      return i.update({ embeds: [embed], components: [] });
    }
  } catch {
    if (i.isRepliable()) {
      const msg = { content: "Something went wrong, try again.", flags: eph };
      if (i.deferred || i.replied) i.followUp(msg).catch(() => {});
      else i.reply(msg).catch(() => {});
    }
  }
});

client.login(TOKEN).catch(() => {});
})();
