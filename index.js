/**
 * ========================================================
 *   WESTJET MILES BOT - index.js (discord.js v14)
 * ========================================================
 *
 * Fonctionnalités :
 * - /panel          -> Poste un panel avec 2 boutons :
 *      "Check Your Miles"  -> montre le solde de miles
 *      "Redeem Miles"      -> ouvre un modal pour entrer un code
 * - /generatecodes  -> Génère jusqu'à 1000 codes uniques valant X miles
 *      chacun, et te donne un fichier .txt à distribuer (staff only)
 * - /addmiles       -> Ajoute des miles manuellement (staff only)
 * - /removemiles    -> Retire des miles manuellement (staff only)
 * - /codestats      -> Voir combien de codes restent / ont été utilisés
 * - /mymiles        -> Un membre check son propre solde
 *
 * Stockage : fichiers JSON locaux (data/miles.json et data/codes.json)
 * Les boutons sont persistants (fonctionnent même après un restart).
 *
 * ========================================================
 *   INSTALLATION
 * ========================================================
 * 1. npm install
 * 2. Mets ton TOKEN, CLIENT_ID et STAFF_ROLE_ID dans config.js (ou .env)
 * 3. node deploy-commands.js   (une seule fois, pour enregistrer les commandes)
 * 4. node index.js
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
} = require("discord.js");
const fs = require("fs");
const path = require("path");

const { TOKEN, STAFF_ROLE_ID } = require("./config.js");

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

function isStaff(interaction) {
  if (interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return true;
  }
  return interaction.member.roles.cache.has(STAFF_ROLE_ID);
}

// ============== CLIENT ==============
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

// ============== VUE : PANEL (boutons persistants) ==============
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

// ============== READY ==============
client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag} - WestJet Miles Bot ready.`);
});

// ============== INTERACTIONS ==============
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // ---------- SLASH COMMANDS ----------
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      if (commandName === "panel") {
        if (!isStaff(interaction)) {
          return interaction.reply({
            content: "❌ You don't have permission to use this command.",
            ephemeral: true,
          });
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

        await interaction.channel.send({
          embeds: [embed],
          components: [buildPanelRow()],
        });
        return interaction.reply({ content: "✅ Panel posted.", ephemeral: true });
      }

      if (commandName === "generatecodes") {
        if (!isStaff(interaction)) {
          return interaction.reply({
            content: "❌ You don't have permission to use this command.",
            ephemeral: true,
          });
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
          return interaction.reply({
            content: "❌ Miles value must be greater than 0.",
            ephemeral: true,
          });
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
        if (!isStaff(interaction)) {
          return interaction.reply({
            content: "❌ You don't have permission to use this command.",
            ephemeral: true,
          });
        }
        const user = interaction.options.getUser("user");
        const amount = interaction.options.getInteger("amount");

        if (amount <= 0) {
          return interaction.reply({
            content: "❌ Amount must be greater than 0.",
            ephemeral: true,
          });
        }

        const newTotal = addMiles(user.id, amount);
        return interaction.reply({
          content: `✅ Added **${amount} miles** to <@${user.id}>. New balance: **${newTotal} miles**.`,
          ephemeral: true,
        });
      }

      if (commandName === "removemiles") {
        if (!isStaff(interaction)) {
          return interaction.reply({
            content: "❌ You don't have permission to use this command.",
            ephemeral: true,
          });
        }
        const user = interaction.options.getUser("user");
        const amount = interaction.options.getInteger("amount");

        if (amount <= 0) {
          return interaction.reply({
            content: "❌ Amount must be greater than 0.",
            ephemeral: true,
          });
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
        if (!isStaff(interaction)) {
          return interaction.reply({
            content: "❌ You don't have permission to use this command.",
            ephemeral: true,
          });
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
        return interaction.reply({
          content: `✈️ You currently have **${balance} miles**.`,
          ephemeral: true,
        });
      }
    }

    // ---------- BOUTONS ----------
    if (interaction.isButton()) {
      if (interaction.customId === "westjet_check_miles") {
        const balance = getMiles(interaction.user.id);
        return interaction.reply({
          content: `✈️ You currently have **${balance} miles**.`,
          ephemeral: true,
        });
      }

      if (interaction.customId === "westjet_redeem_miles") {
        const modal = new ModalBuilder()
          .setCustomId("westjet_redeem_modal")
          .setTitle("Redeem Miles Code");

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
        return interaction.reply({
          content: "⚠️ This code has already been redeemed.",
          ephemeral: true,
        });
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
