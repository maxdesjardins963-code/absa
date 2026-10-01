/**
 * WESTJET MILES BOT - index.js (discord.js v14)
 * Miles + codes + Miles Shop dans le même bot.
 *
 * Variables d'environnement :
 *   TOKEN, CLIENT_ID, GUILD_ID, STAFF_ROLE_ID
 *   SHOP_LOG_CHANNEL_ID (optionnel, salon staff où arrivent les achats)
 *
 * Build Command : npm install
 * Start Command : node index.js
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
  StringSelectMenuBuilder,
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
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("WestJet Miles Bot is running.");
  })
  .listen(PORT, () => {
    console.log(`Dummy HTTP server listening on port ${PORT} (for Render)`);
  });

// ============== CHEMINS DE STOCKAGE ==============
const DATA_DIR = path.join(__dirname, "data");
const MILES_FILE = path.join(DATA_DIR, "miles.json");
const CODES_FILE = path.join(DATA_DIR, "codes.json");
const FLIGHTS_FILE = path.join(DATA_DIR, "flights.json");
const SHOP_FILE = path.join(DATA_DIR, "shop.json");
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
    console.error("Variables d'environnement manquantes :");
    missing.forEach((m) => console.error(`   - ${m}`));
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

// ============== MILES SHOP ==============

// ce qu'on vend (change les prix ici)
const SHOP_ITEMS = {
  premium: { name: "Premium Economy", price: 6000 },
  business: { name: "Business Class", price: 12500 },
  first: { name: "First Class", price: 25000 },
};

// statut selon le total de miles gagnés, avec un rabais sur les prix
const SHOP_TIERS = [
  { name: "Platinum", min: 30000, off: 0.15 },
  { name: "Gold", min: 15000, off: 0.1 },
  { name: "Silver", min: 5000, off: 0.05 },
  { name: "Member", min: 0, off: 0 },
];

const EPH = MessageFlags.Ephemeral;
const TEN_MIN = 10 * 60 * 1000;

// choix en cours pour chaque membre
const pending = new Map();

function getPending(userId) {
  const p = pending.get(userId);
  if (!p || Date.now() - p.ts > TEN_MIN) {
    pending.delete(userId);
    return null;
  }
  return p;
}

function getFlights() {
  const f = loadJson(FLIGHTS_FILE);
  return Array.isArray(f) ? f : [];
}

function getShopData() {
  const s = loadJson(SHOP_FILE);
  return { spent: s.spent || {}, orders: s.orders || [] };
}

// miles gagnés au total = solde actuel + ce qui a été dépensé dans le shop
function getEarned(userId) {
  return getMiles(userId) + (getShopData().spent[userId] || 0);
}

const getTier = (earned) => SHOP_TIERS.find((t) => earned >= t.min);
const priceFor = (item, earned) => Math.round(item.price * (1 - getTier(earned).off));
const fmt = (n) => n.toLocaleString("en-US");

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
      Object.values(SHOP_ITEMS).map((it) => ({
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
      Object.entries(SHOP_ITEMS).map(([key, it]) => ({
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
  const next = [...SHOP_TIERS].reverse().find((t) => t.min > earned);
  let txt = `You have **${fmt(balance)} miles**.\nStatus: **${tier.name}**`;
  if (tier.off) txt += ` (${Math.round(tier.off * 100)}% off the shop)`;
  if (next) txt += `\n${fmt(next.min - earned)} more miles to reach **${next.name}**.`;
  return txt;
}

function shopCommands() {
  return [
    new SlashCommandBuilder().setName("shop").setDescription("Open the miles shop"),
    new SlashCommandBuilder().setName("status").setDescription("See your miles and your status"),
    new SlashCommandBuilder().setName("shoppanel").setDescription("Post the shop panel (staff only)"),
    new SlashCommandBuilder()
      .setName("addflight")
      .setDescription("Add an event flight to the shop list (staff only)")
      .addStringOption((o) =>
        o.setName("name").setDescription("Example: QS 2210 YUL-CDG").setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName("delflight")
      .setDescription("Remove an event flight from the shop list (staff only)")
      .addStringOption((o) =>
        o.setName("name").setDescription("Exact name of the flight").setRequired(true)
      ),
  ];
}

// renvoie true si l'interaction concernait le shop (donc déjà traitée)
async function handleShop(i, client, STAFF_ROLE_ID) {
  // ----- commandes slash -----
  if (i.isChatInputCommand()) {
    if (i.commandName === "shop") {
      await i.reply({ ...shopView(i.user.id), flags: EPH });
      return true;
    }

    if (i.commandName === "status") {
      await i.reply({ content: statusText(i.user.id), flags: EPH });
      return true;
    }

    if (i.commandName === "shoppanel") {
      if (!isStaff(i, STAFF_ROLE_ID)) {
        await i.reply({ content: "You can't use this.", flags: EPH });
        return true;
      }

      const embed = new EmbedBuilder()
        .setTitle("WestJet Miles Shop")
        .setColor(0x1abc9c)
        .setDescription(
          "Spend your miles on an upgrade for one of our event flights.\n\n" +
            Object.values(SHOP_ITEMS)
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
      await i.reply({ content: "Panel posted.", flags: EPH });
      return true;
    }

    if (i.commandName === "addflight") {
      if (!isStaff(i, STAFF_ROLE_ID)) {
        await i.reply({ content: "You can't use this.", flags: EPH });
        return true;
      }
      const name = i.options.getString("name").trim().slice(0, 90);
      const list = getFlights();
      if (list.length >= 25) {
        await i.reply({ content: "The list is full (25 flights max).", flags: EPH });
        return true;
      }
      if (list.includes(name)) {
        await i.reply({ content: "That flight is already in the list.", flags: EPH });
        return true;
      }
      list.push(name);
      saveJson(FLIGHTS_FILE, list);
      await i.reply({ content: `Added **${name}**.`, flags: EPH });
      return true;
    }

    if (i.commandName === "delflight") {
      if (!isStaff(i, STAFF_ROLE_ID)) {
        await i.reply({ content: "You can't use this.", flags: EPH });
        return true;
      }
      const name = i.options.getString("name").trim();
      const list = getFlights();
      if (!list.includes(name)) {
        await i.reply({ content: "Flight not found, check the exact name.", flags: EPH });
        return true;
      }
      saveJson(FLIGHTS_FILE, list.filter((f) => f !== name));
      await i.reply({ content: `Removed **${name}**.`, flags: EPH });
      return true;
    }

    return false;
  }

  // ----- boutons du panel -----
  if (i.isButton() && i.customId === "ms_open") {
    await i.reply({ ...shopView(i.user.id), flags: EPH });
    return true;
  }

  if (i.isButton() && i.customId === "ms_status") {
    await i.reply({ content: statusText(i.user.id), flags: EPH });
    return true;
  }

  // ----- 1. classe choisie, on demande le nom Roblox -----
  if (i.isStringSelectMenu() && i.customId === "ms_pick") {
    const key = i.values[0];
    const item = SHOP_ITEMS[key];
    if (!item) return true;

    const cost = priceFor(item, getEarned(i.user.id));
    const balance = getMiles(i.user.id);
    if (balance < cost) {
      await i.reply({
        content: `You need ${fmt(cost - balance)} more miles for ${item.name}.`,
        flags: EPH,
      });
      return true;
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
    await i.showModal(modal);
    return true;
  }

  // ----- 2. nom Roblox reçu, on choisit le vol event -----
  if (i.isModalSubmit() && i.customId === "ms_roblox") {
    const p = getPending(i.user.id);
    if (!p) {
      await i.reply({ content: "That took too long, use /shop again.", flags: EPH });
      return true;
    }

    const roblox = i.fields.getTextInputValue("roblox_name").trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(roblox)) {
      await i.reply({
        content: "That doesn't look like a Roblox username. Try again from /shop.",
        flags: EPH,
      });
      return true;
    }
    p.roblox = roblox;

    const flights = getFlights();
    if (flights.length === 0) {
      await i.reply({ content: "There are no event flights open right now.", flags: EPH });
      return true;
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId("ms_flight")
      .setPlaceholder("Pick the event flight")
      .addOptions(flights.map((f) => ({ label: f, value: f })));

    await i.reply({
      content: "Which event flight is this upgrade for?",
      components: [new ActionRowBuilder().addComponents(menu)],
      flags: EPH,
    });
    return true;
  }

  // ----- 3. vol choisi, confirmation -----
  if (i.isStringSelectMenu() && i.customId === "ms_flight") {
    const p = getPending(i.user.id);
    if (!p) {
      await i.update({ content: "That took too long, use /shop again.", components: [] });
      return true;
    }

    p.flight = i.values[0];
    const cost = priceFor(SHOP_ITEMS[p.key], getEarned(i.user.id));

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("ms_yes").setLabel("Confirm").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("ms_no").setLabel("Cancel").setStyle(ButtonStyle.Secondary)
    );

    await i.update({
      content:
        `**${SHOP_ITEMS[p.key].name}** on **${p.flight}**\n` +
        `Roblox: **${p.roblox}**\n` +
        `Price: **${fmt(cost)} miles**`,
      components: [row],
    });
    return true;
  }

  // ----- 4. confirmation finale -----
  if (i.isButton() && i.customId === "ms_no") {
    pending.delete(i.user.id);
    await i.update({ content: "Purchase cancelled.", components: [] });
    return true;
  }

  if (i.isButton() && i.customId === "ms_yes") {
    const p = getPending(i.user.id);
    if (!p || !p.flight || !p.roblox) {
      await i.update({ content: "That took too long, use /shop again.", components: [] });
      return true;
    }
    pending.delete(i.user.id);

    const item = SHOP_ITEMS[p.key];
    const cost = priceFor(item, getEarned(i.user.id));

    const miles = loadJson(MILES_FILE);
    if ((miles[i.user.id] || 0) < cost) {
      await i.update({ content: "You don't have enough miles anymore.", components: [] });
      return true;
    }
    miles[i.user.id] -= cost;
    saveJson(MILES_FILE, miles);

    const shop = getShopData();
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
    saveJson(SHOP_FILE, shop);

    const logId = process.env.SHOP_LOG_CHANNEL_ID;
    if (logId) {
      const channel = await client.channels.fetch(logId).catch(() => null);
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

    await i.update({
      content:
        `Done! Your **${item.name}** on **${p.flight}** is booked for **${p.roblox}**.\n` +
        `Remaining balance: **${fmt(miles[i.user.id])} miles**. Staff will set it up for you.`,
      components: [],
    });
    return true;
  }

  // ----- staff: commande traitée -----
  if (i.isButton() && i.customId.startsWith("ms_done_")) {
    if (!isStaff(i, STAFF_ROLE_ID)) {
      await i.reply({ content: "You can't use this.", flags: EPH });
      return true;
    }
    const embed = EmbedBuilder.from(i.message.embeds[0])
      .setColor(0x2ecc71)
      .setFooter({ text: `Handled by ${i.user.username}` });
    await i.update({ embeds: [embed], components: [] });
    return true;
  }

  return false;
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

    ...shopCommands(),
  ].map((cmd) => cmd.toJSON());

  const rest = new REST({ version: "10" }).setToken(TOKEN);

  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
}

// ============== DÉMARRAGE ==============
(async () => {
  const { TOKEN, CLIENT_ID, GUILD_ID, STAFF_ROLE_ID } = loadConfig();

  try {
    await deployCommands(TOKEN, CLIENT_ID, GUILD_ID);
  } catch (err) {
    console.error("Erreur lors du déploiement des commandes :", err.message);
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  });

  client.once(Events.ClientReady, (c) => {
    console.log(`Logged in as ${c.user.tag}`);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      // le shop passe en premier, s'il a géré l'interaction on s'arrête
      if (await handleShop(interaction, client, STAFF_ROLE_ID)) return;

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
