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
  REST,
  Routes,
  SlashCommandBuilder,
} = require("discord.js");
const fs = require("fs");
const path = require("path");

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
            return interaction.reply({ content: "❌ You don't have permission to use this command.", ephemeral: true });
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
          return interaction.reply({ content: "✅ Panel posted.", ephemeral: true });
        }

        if (commandName === "generatecodes") {
          if (!isStaff(interaction, STAFF_ROLE_ID)) {
            return interaction.reply({ content: "❌ You don't have permission to use this command.", ephemeral: true });
          }

          const amount = interaction.options.getInteger("amount");
          const milesValue = interaction.options.getInteger("miles");

          if (amount <= 0 || amount > MAX_CODES_PER_GENERATION) {
            return interaction.reply({
              content: `❌ Amount must be between 1 and ${MAX_CODES_PER_GENERATION}.`,
              ephemeral: true,
            });
          }
          if (milesValue <= 0) {
            return interaction.reply({ content: "❌ Miles value must be greater than 0.", ephemeral: true });
          }

          await interaction.deferReply({ ephemeral: true });

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
            return interaction.reply({ content: "❌ You don't have permission to use this command.", ephemeral: true });
          }
          const user = interaction.options.getUser("user");
          const amount = interaction.options.getInteger("amount");

          if (amount <= 0) {
            return interaction.reply({ content: "❌ Amount must be greater than 0.", ephemeral: true });
          }

          const newTotal = addMiles(user.id, amount);
          return interaction.reply({
            content: `✅ Added **${amount} miles** to <@${user.id}>. New balance: **${newTotal} miles**.`,
            ephemeral: true,
          });
        }

        if (commandName === "removemiles") {
          if (!isStaff(interaction, STAFF_ROLE_ID)) {
            return interaction.reply({ content: "❌ You don't have permission to use this command.", ephemeral: true });
          }
          const user = interaction.options.getUser("user");
          const amount = interaction.options.getInteger("amount");

          if (amount <= 0) {
            return interaction.reply({ content: "❌ Amount must be greater than 0.", ephemeral: true });
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
            ephemeral: true,
          });
        }

        if (commandName === "codestats") {
          if (!isStaff(interaction, STAFF_ROLE_ID)) {
            return interaction.reply({ content: "❌ You don't have permission to use this command.", ephemeral: true });
          }
          const codes = loadJson(CODES_FILE);
          const total = Object.keys(codes).length;
          const used = Object.values(codes).filter((c) => c.used).length;
          const remaining = total - used;

          return interaction.reply({
            content: `📊 **Code Stats**\nTotal: ${total}\nUsed: ${used}\nRemaining: ${remaining}`,
            ephemeral: true,
          });
        }

        if (commandName === "mymiles") {
          const balance = getMiles(interaction.user.id);
          return interaction.reply({ content: `✈️ You currently have **${balance} miles**.`, ephemeral: true });
        }
      }

      // ---------- BOUTONS ----------
      if (interaction.isButton()) {
        if (interaction.customId === "westjet_check_miles") {
          const balance = getMiles(interaction.user.id);
          return interaction.reply({ content: `✈️ You currently have **${balance} miles**.`, ephemeral: true });
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
          return interaction.reply({ content: "❌ This code is invalid.", ephemeral: true });
        }

        const codeData = codes[enteredCode];
        if (codeData.used) {
          return interaction.reply({ content: "⚠️ This code has already been redeemed.", ephemeral: true });
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
          ephemeral: true,
        });
      }
    } catch (err) {
      console.error(err);
      if (interaction.isRepliable()) {
        const errorPayload = { content: "❌ An error occurred.", ephemeral: true };
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
