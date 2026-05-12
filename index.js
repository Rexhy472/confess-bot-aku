require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");

const fs = require("fs");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

// 0 = cooldown mati.
// Kalau nanti mau aktifin 5 menit, ubah jadi: 5 * 60 * 1000
const COOLDOWN_MS = 0;

function loadDb() {
  if (!fs.existsSync("db.json")) {
    fs.writeFileSync(
      "db.json",
      JSON.stringify({ cooldowns: {}, confessions: {} }, null, 2)
    );
  }

  return JSON.parse(fs.readFileSync("db.json", "utf8"));
}

function saveDb(db) {
  fs.writeFileSync("db.json", JSON.stringify(db, null, 2));
}

client.once("ready", () => {
  console.log(`Bot online sebagai ${client.user.tag}`);
});

client.on("interactionCreate", async interaction => {
  const db = loadDb();

  if (interaction.isChatInputCommand()) {
    if (interaction.commandName !== "confess") return;

    const sender = interaction.user;
    const target = interaction.options.getUser("target");
    const message = interaction.options.getString("pesan");
    const anonymous = interaction.options.getBoolean("anonim");

    if (target.bot) {
      return interaction.reply({
        content: "❌ Tidak bisa confess ke bot.",
        ephemeral: true
      });
    }

    if (target.id === sender.id) {
      return interaction.reply({
        content: "❌ Tidak bisa confess ke diri sendiri.",
        ephemeral: true
      });
    }

    if (COOLDOWN_MS > 0) {
      const now = Date.now();
      const lastUsed = db.cooldowns[sender.id] || 0;

      if (now - lastUsed < COOLDOWN_MS) {
        const remaining = Math.ceil((COOLDOWN_MS - (now - lastUsed)) / 60000);

        return interaction.reply({
          content: `⏳ Tunggu ${remaining} menit sebelum confess lagi.`,
          ephemeral: true
        });
      }

      db.cooldowns[sender.id] = now;
    }

    const confessId = Date.now().toString();

    db.confessions[confessId] = {
      senderId: sender.id,
      senderTag: sender.tag,
      targetId: target.id,
      targetTag: target.tag,
      message,
      anonymous,
      status: "pending",
      createdAt: new Date().toISOString()
    };

    saveDb(db);

    const confessEmbed = new EmbedBuilder()
      .setTitle("💌 Ada Confess Untukmu")
      .setDescription(message)
      .addFields({
        name: "Pengirim",
        value: anonymous ? "Anonymous" : sender.tag
      })
      .setFooter({ text: `Confess ID: ${confessId}` })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`accept_${confessId}`)
        .setLabel("Accept")
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId(`deny_${confessId}`)
        .setLabel("Deny")
        .setStyle(ButtonStyle.Danger),

      new ButtonBuilder()
        .setCustomId(`denyreason_${confessId}`)
        .setLabel("Deny + Reason")
        .setStyle(ButtonStyle.Secondary)
    );

    try {
      await target.send({
        embeds: [confessEmbed],
        components: [row]
      });

      await interaction.reply({
        content: "✅ Confess berhasil dikirim ke target.",
        ephemeral: true
      });
    } catch {
      delete db.confessions[confessId];
      saveDb(db);

      await interaction.reply({
        content: "❌ Gagal kirim DM. Kemungkinan DM target tertutup.",
        ephemeral: true
      });
    }

    return;
  }

  if (interaction.isButton()) {
    const [action, confessId] = interaction.customId.split("_");
    const confession = db.confessions[confessId];

    if (!confession) {
      return interaction.reply({
        content: "❌ Data confess tidak ditemukan.",
        ephemeral: true
      });
    }

    if (interaction.user.id !== confession.targetId) {
      return interaction.reply({
        content: "❌ Hanya target yang bisa merespons confess ini.",
        ephemeral: true
      });
    }

    if (action === "accept") {
      confession.status = "accepted";
      confession.respondedAt = new Date().toISOString();
      saveDb(db);

      await notifySender(confession, `💖 Confess kamu diterima oleh ${interaction.user.tag}.`);
      await sendLog(confession, "Accepted");

      return interaction.update({
        content: "✅ Kamu menerima confess ini.",
        embeds: [],
        components: []
      });
    }

    if (action === "deny") {
      confession.status = "denied";
      confession.respondedAt = new Date().toISOString();
      saveDb(db);

      await notifySender(confession, `💔 Confess kamu ditolak oleh ${interaction.user.tag}.`);
      await sendLog(confession, "Denied");

      return interaction.update({
        content: "❌ Kamu menolak confess ini.",
        embeds: [],
        components: []
      });
    }

    if (action === "denyreason") {
      const modal = new ModalBuilder()
        .setCustomId(`denyreasonmodal_${confessId}`)
        .setTitle("Alasan Penolakan");

      const reasonInput = new TextInputBuilder()
        .setCustomId("reason")
        .setLabel("Masukkan alasan")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder().addComponents(reasonInput)
      );

      return interaction.showModal(modal);
    }
  }

  if (interaction.isModalSubmit()) {
    if (!interaction.customId.startsWith("denyreasonmodal_")) return;

    const confessId = interaction.customId.replace("denyreasonmodal_", "");
    const confession = db.confessions[confessId];

    if (!confession) {
      return interaction.reply({
        content: "❌ Data confess tidak ditemukan.",
        ephemeral: true
      });
    }

    const reason = interaction.fields.getTextInputValue("reason");

    confession.status = "denied_with_reason";
    confession.reason = reason;
    confession.respondedAt = new Date().toISOString();
    saveDb(db);

    await notifySender(
      confession,
      `💔 Confess kamu ditolak oleh ${interaction.user.tag}.\n\n📝 Alasan: ${reason}`
    );

    await sendLog(confession, "Denied with Reason");

    return interaction.reply({
      content: "❌ Confess ditolak dengan alasan.",
      ephemeral: true
    });
  }
});

async function notifySender(confession, text) {
  try {
    const sender = await client.users.fetch(confession.senderId);
    await sender.send(text);
  } catch {
    console.log("Gagal DM pengirim.");
  }
}

async function sendLog(confession, result) {
  try {
    const logChannel = await client.channels.fetch(process.env.LOG_CHANNEL_ID);

    const embed = new EmbedBuilder()
      .setTitle("📋 Confess Log")
      .addFields(
        { name: "Status", value: result, inline: true },
        { name: "Anonymous", value: confession.anonymous ? "Ya" : "Tidak", inline: true },
        { name: "Sender", value: `${confession.senderTag}\n${confession.senderId}` },
        { name: "Target", value: `${confession.targetTag}\n${confession.targetId}` },
        { name: "Pesan", value: confession.message }
      )
      .setTimestamp();

    if (confession.reason) {
      embed.addFields({
        name: "Alasan Penolakan",
        value: confession.reason
      });
    }

    await logChannel.send({ embeds: [embed] });
  } catch {
    console.log("Gagal kirim log.");
  }
}

client.login(process.env.DISCORD_TOKEN);
