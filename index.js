/**
 * WESTJET MILES BOT - index.js (discord.js v14)
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

// faux serveur pour Render
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("WestJet Miles Bot is running.");
  })
  .listen(process.env.PORT || 3000);

// ---------- fichiers ----------
const DATA_DIR = path.join(__dirname, "data");
const MILES_FILE = path.join(DATA_DIR, "miles.json");
const CODES_FILE = path.join(DATA_DIR, "codes.json");
const FLIGHTS_FILE = path.join(DATA_DIR, "flights.json");
const SHOP_FILE = path.join(DATA_DIR, "shop.json");
const MAX_CODES = 1000;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function loadJson(file) {
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return {};
  }
}

function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
}

// ---------- config ----------
const { TOKEN, CLIENT_ID, GUILD_ID, STAFF_ROLE_ID } = process.env;

if (!TOKEN || !CLIENT_ID || !GUILD_ID || !STAFF_ROLE_ID) {
  console.error("Il manque des variables : TOKEN, CLIENT_ID, GUILD_ID ou STAFF_ROLE_ID");
  process.exit(1);
}

// ---------- miles ----------
function getMiles(userId) {
  return loadJson(MILES_FILE)[userId] || 0;
}

function addMiles(userId, amount) {
  const miles = loadJson(MILES_FILE);
  miles[userId] = (miles[userId] || 0) + amount;
  saveJson(MILES_FILE, miles);
  return miles[userId];
}

function newCode(existing) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code;
  do {
    let r = "";
    for (let i = 0; i < 8; i++) r += chars[Math.floor(Math.random() * chars.length)];
    code = `WJ-${r}`;
  } while (existing.has(code));
  return code;
}

function isStaff(i) {
  if (i.member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return i.member.roles.cache.has(STAFF_ROLE_ID);
}

// ---------- shop ----------
const ITEMS = {
  premium: { name: "Premium Economy", price: 6000 },
  business: { name: "Business Class", price: 12500 },
  first: { name: "First Class", price: 25000 },
};

// statut selon le total de miles gagnés + rabais dans le shop
const TIERS = [
  { name: "Platinum", min: 30000, off: 0.15 },
  { name: "Gold", min: 15000, off: 0.1 },
  { name: "Silver", min: 5000, off: 0.05 },
  { name: "Member", min: 0, off: 0 },
];

const EPH = MessageFlags.Ephemeral;
const pending = new Map();

function getPending(userId) {
  const p = pending.get(userId);
  if (!p || Date.now() - p.ts > 10 * 60 * 1000) {
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

// miles gagnés au total = solde + ce qui a été dépensé au shop
const getEarned = (id) => getMiles(id) + (getShopData().spent[id] || 0);
const getTier = (earned) => TIERS.find((t) => earned >= t.min);
const priceFor = (item, earned) => Math.round(item.price * (1 - getTier(earned).off));
const fmt = (n) => n.toLocaleString("en-US");

function shopView(userId) {
  const earned = getEarned(userId);
  const tier = getTier(earned);

  const embed = new EmbedBuilder()
    .setTitle("WestJet Miles Shop")
    .setColor(0x1abc9c)
    .setDescription(
      `Balance: **${fmt(getMiles(userId))} miles**\nStatus: **${tier.name}**` +
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

// ---------- commandes ----------
async function deployCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("panel")
      .setDescription("Post the WestJet miles panel (staff only)"),

    new SlashCommandBuilder()
      .setName("generatecodes")
      .setDescription("Generate redeemable miles codes (staff only)")
      .addIntegerOption((o) =>
        o.setName("amount").setDescription("How many codes to generate (max 1000)").setRequired(true)
      )
      .addIntegerOption((o) =>
        o.setName("miles").setDescription("How many miles each code is worth").setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("addflight")
      .setDescription("Add an event flight to the shop (staff only)")
      .addStringOption((o) =>
        o.setName("name").setDescription("Example: QS 2210 YUL-CDG").setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("removeflight")
      .setDescription("Remove an event flight from the shop (staff only)")
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
  deployCommands().catch((err) => console.error("Commands error:", err.message));
});

client.on(Events.InteractionCreate, async (i) => {
  try {
    // ===== slash =====
    if (i.isChatInputCommand()) {
      const staffOnly = ["panel", "generatecodes", "addflight", "removeflight"];
      if (staffOnly.includes(i.commandName) && !isStaff(i)) {
        return i.reply({ content: "You don't have permission to use this command.", flags: EPH });
      }

      if (i.commandName === "panel") {
        const embed = new EmbedBuilder()
          .setTitle("WestJet Miles Program")
          .setColor(0x1abc9c)
          .setDescription(
            "**Redeem Miles**: enter a code to add miles to your account\n" +
              "**Miles Shop**: spend your miles on an upgrade for an event flight\n\n" +
              Object.values(ITEMS)
                .map((it) => `${it.name}: ${fmt(it.price)} miles`)
                .join("\n")
          )
          .setFooter({ text: "WestJet | Miles Program" });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("redeem_open").setLabel("Redeem Miles").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId("shop_open").setLabel("Miles Shop").setStyle(ButtonStyle.Success)
        );

        await i.channel.send({ embeds: [embed], components: [row] });
        return i.reply({ content: "Panel posted.", flags: EPH });
      }

      if (i.commandName === "generatecodes") {
        const amount = i.options.getInteger("amount");
        const milesValue = i.options.getInteger("miles");

        if (amount <= 0 || amount > MAX_CODES) {
          return i.reply({ content: `Amount must be between 1 and ${MAX_CODES}.`, flags: EPH });
        }
        if (milesValue <= 0) {
          return i.reply({ content: "Miles value must be greater than 0.", flags: EPH });
        }

        await i.deferReply({ flags: EPH });

        const codes = loadJson(CODES_FILE);
        const existing = new Set(Object.keys(codes));
        const created = [];

        for (let n = 0; n < amount; n++) {
          const code = newCode(existing);
          existing.add(code);
          codes[code] = {
            miles: milesValue,
            used: false,
            createdBy: i.user.id,
            createdAt: new Date().toISOString(),
          };
          created.push(code);
        }
        saveJson(CODES_FILE, codes);

        const file = new AttachmentBuilder(Buffer.from(created.join("\n"), "utf-8"), {
          name: `codes_${milesValue}miles_${amount}.txt`,
        });

        return i.editReply({
          content: `Generated **${amount} codes**, each worth **${fmt(milesValue)} miles**.`,
          files: [file],
        });
      }

      if (i.commandName === "addflight") {
        const name = i.options.getString("name").trim().slice(0, 90);
        const list = getFlights();
        if (list.length >= 25) {
          return i.reply({ content: "The list is full (25 flights max).", flags: EPH });
        }
        if (list.includes(name)) {
          return i.reply({ content: "That flight is already in the list.", flags: EPH });
        }
        list.push(name);
        saveJson(FLIGHTS_FILE, list);
        return i.reply({ content: `Added **${name}**.`, flags: EPH });
      }

      if (i.commandName === "removeflight") {
        const name = i.options.getString("name").trim();
        const list = getFlights();
        if (!list.includes(name)) {
          return i.reply({ content: "Flight not found, check the exact name.", flags: EPH });
        }
        saveJson(FLIGHTS_FILE, list.filter((f) => f !== name));
        return i.reply({ content: `Removed **${name}**.`, flags: EPH });
      }
    }

    // ===== redeem =====
    if (i.isButton() && i.customId === "redeem_open") {
      const modal = new ModalBuilder().setCustomId("redeem_modal").setTitle("Redeem Miles Code");
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("code_input")
            .setLabel("Enter your code")
            .setPlaceholder("WJ-XXXXXXXX")
            .setStyle(TextInputStyle.Short)
            .setMinLength(3)
            .setMaxLength(32)
            .setRequired(true)
        )
      );
      return i.showModal(modal);
    }

    if (i.isModalSubmit() && i.customId === "redeem_modal") {
      const entered = i.fields.getTextInputValue("code_input").trim().toUpperCase();
      const codes = loadJson(CODES_FILE);

      if (!codes[entered]) {
        return i.reply({ content: "This code is invalid.", flags: EPH });
      }
      if (codes[entered].used) {
        return i.reply({ content: "This code has already been redeemed.", flags: EPH });
      }

      const value = codes[entered].miles || 0;
      const total = addMiles(i.user.id, value);

      codes[entered].used = true;
      codes[entered].redeemedBy = i.user.id;
      codes[entered].redeemedAt = new Date().toISOString();
      saveJson(CODES_FILE, codes);

      return i.reply({
        content: `Code redeemed! You received **${fmt(value)} miles**.\nNew balance: **${fmt(total)} miles**.`,
        flags: EPH,
      });
    }

    // ===== shop =====
    if (i.isButton() && i.customId === "shop_open") {
      return i.reply({ ...shopView(i.user.id), flags: EPH });
    }

    // 1. classe choisie, on demande le nom Roblox
    if (i.isStringSelectMenu() && i.customId === "ms_pick") {
      const item = ITEMS[i.values[0]];
      if (!item) return;

      const cost = priceFor(item, getEarned(i.user.id));
      const balance = getMiles(i.user.id);
      if (balance < cost) {
        return i.reply({
          content: `You need ${fmt(cost - balance)} more miles for ${item.name}.`,
          flags: EPH,
        });
      }

      pending.set(i.user.id, { key: i.values[0], ts: Date.now() });

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

    // 2. nom Roblox reçu, on choisit le vol event
    if (i.isModalSubmit() && i.customId === "ms_roblox") {
      const p = getPending(i.user.id);
      if (!p) return i.reply({ content: "That took too long, open the shop again.", flags: EPH });

      const roblox = i.fields.getTextInputValue("roblox_name").trim();
      if (!/^[A-Za-z0-9_]{3,20}$/.test(roblox)) {
        return i.reply({ content: "That doesn't look like a Roblox username, try again.", flags: EPH });
      }
      p.roblox = roblox;

      const flights = getFlights();
      if (flights.length === 0) {
        return i.reply({ content: "There are no event flights open right now.", flags: EPH });
      }

      const menu = new StringSelectMenuBuilder()
        .setCustomId("ms_flight")
        .setPlaceholder("Pick the event flight")
        .addOptions(flights.map((f) => ({ label: f, value: f })));

      return i.reply({
        content: "Which event flight is this upgrade for?",
        components: [new ActionRowBuilder().addComponents(menu)],
        flags: EPH,
      });
    }

    // 3. vol choisi, confirmation
    if (i.isStringSelectMenu() && i.customId === "ms_flight") {
      const p = getPending(i.user.id);
      if (!p) return i.update({ content: "That took too long, open the shop again.", components: [] });

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

    // 4. confirmation finale
    if (i.isButton() && i.customId === "ms_no") {
      pending.delete(i.user.id);
      return i.update({ content: "Purchase cancelled.", components: [] });
    }

    if (i.isButton() && i.customId === "ms_yes") {
      const p = getPending(i.user.id);
      if (!p || !p.flight || !p.roblox) {
        return i.update({ content: "That took too long, open the shop again.", components: [] });
      }
      pending.delete(i.user.id);

      const item = ITEMS[p.key];
      const cost = priceFor(item, getEarned(i.user.id));

      const miles = loadJson(MILES_FILE);
      if ((miles[i.user.id] || 0) < cost) {
        return i.update({ content: "You don't have enough miles anymore.", components: [] });
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

      return i.update({
        content:
          `Done! Your **${item.name}** on **${p.flight}** is booked for **${p.roblox}**.\n` +
          `Remaining balance: **${fmt(miles[i.user.id])} miles**. Staff will set it up for you.`,
        components: [],
      });
    }

    // staff: achat traité
    if (i.isButton() && i.customId.startsWith("ms_done_")) {
      if (!isStaff(i)) return i.reply({ content: "You don't have permission.", flags: EPH });
      const embed = EmbedBuilder.from(i.message.embeds[0])
        .setColor(0x2ecc71)
        .setFooter({ text: `Handled by ${i.user.username}` });
      return i.update({ embeds: [embed], components: [] });
    }
  } catch (err) {
    console.error(err);
    if (i.isRepliable()) {
      const msg = { content: "An error occurred.", flags: EPH };
      if (i.deferred || i.replied) i.followUp(msg).catch(() => {});
      else i.reply(msg).catch(() => {});
    }
  }
});

client.login(TOKEN);
