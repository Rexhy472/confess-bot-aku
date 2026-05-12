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
  TextInputStyle,
  PermissionsBitField
} = require("discord.js");

const fs = require("fs");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

// ==========================================
// CONFIG
// 0 = cooldown mati
// Kalau mau 5 menit: 5 * 60 * 1000
// ==========================================
const COOLDOWN_MS = 0;

// ==========================================
// DATABASE
// ==========================================
function loadDb() {
  if (!fs.existsSync("db.json")) {
    fs.writeFileSync(
      "db.json",
      JSON.stringify(
        {
          cooldowns: {},
          confessions: {}
        },
        null,
        2
      )
    );
  }

  return JSON.parse(fs.readFileSync("db.json", "utf8"));
}

function saveDb(db) {
  fs.writeFileSync("db.json", JSON.stringify(db, null, 2));
}

// ==========================================
// STAFF CHECK (SUPPORT MULTIPLE ROLES)
// STAFF_ROLE_IDS=123456789,987654321
// ==========================================
function isStaff(member) {
  if (!member) return false;

  if (
    member.permissions.has(
      PermissionsBitField.Flags.Administrator
    )
  ) {
    return true;
  }

  const roleIds = process.env.STAFF_ROLE_IDS
    ?.split(",")
    .map(id => id.trim())
    .filter(Boolean);

  if (!roleIds || roleIds.length === 0) {
    return false;
  }

  return roleIds.some(roleId =>
    member.roles.cache.has(roleId)
  );
}

// ==========================================
// READY
// ==========================================
client.once("ready", () => {
  console.log(`✅ Bot online sebagai ${client.user.tag}`);
});

// ==========================================
// MAIN INTERACTION HANDLER
// ==========================================
client.on("interactionCreate", async interaction => {
  const db = loadDb();

  // ========================================
  // SLASH COMMAND: /confess
  // ========================================
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName !== "confess") return;

    const sender = interaction.user;
    const target = interaction.options.getUser("target");
    const message = interaction.options.getString("pesan");
    const anonymous = interaction.options.getBoolean("anonim");

    // Validasi
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

    // Cooldown (opsional)
    if (COOLDOWN_MS > 0) {
      const now = Date.now();
      const lastUsed = db.cooldowns[sender.id] || 0;

      if (now - lastUsed < COOLDOWN_MS) {
        const remaining = Math.ceil(
          (COOLDOWN_MS - (now - lastUsed)) / 60000
        );

        return interaction.reply({
          content: `⏳ Tunggu ${remaining} menit sebelum mengirim confess lagi.`,
          ephemeral: true
        });
      }

      db.cooldowns[sender.id] = now;
    }

    // Simpan data
    const confessionId = Date.now().toString();

    db.confessions[confessionId] = {
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

    // Embed DM ke target
    const embed = new EmbedBuilder()
      .setTitle("💌 Kamu menerima confess!")
      .setDescription(message)
      .addFields({
        name: "👤 Dari",
        value: anonymous ? "Seseorang" : sender.tag
      })
      .setFooter({
        text: `Confess ID: ${confessionId}`
      })
      .setTimestamp();

    // Tombol
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`accept_${confessionId}`)
        .setLabel("ACC")
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId(`deny_${confessionId}`)
        .setLabel("DENY")
        .setStyle(ButtonStyle.Danger),

      new ButtonBuilder()
        .setCustomId(`denyreason_${confessionId}`)
        .setLabel("DENY + REASON")
        .setStyle(ButtonStyle.Secondary)
    );

    // Kirim DM
    try {
      await target.send({
        embeds: [embed],
        components: [row]
      });

      await interaction.reply({
        content:
          "✅ Confess berhasil dikirim dan sedang menunggu respons.",
        ephemeral: true
      });
    } catch {
      delete db.confessions[confessionId];
      saveDb(db);

      await interaction.reply({
        content:
          "❌ Gagal mengirim DM ke target. Kemungkinan DM mereka tertutup.",
        ephemeral: true
      });
    }

    return;
  }

  // ========================================
  // BUTTON INTERACTIONS
  // ========================================
  if (interaction.isButton()) {
    const [action, confessionId] =
      interaction.customId.split("_");

    const confession = db.confessions[confessionId];

    if (!confession) {
      return interaction.reply({
        content: "❌ Data confess tidak ditemukan.",
        ephemeral: true
      });
    }

    // Hanya target yang boleh merespons
    if (interaction.user.id !== confession.targetId) {
      return interaction.reply({
        content:
          "❌ Hanya target yang bisa merespons confess ini.",
        ephemeral: true
      });
    }

    // ACC
    if (action === "accept") {
      confession.status = "accepted";
      confession.respondedBy = interaction.user.id;
      confession.respondedAt = new Date().toISOString();
      saveDb(db);

      await notifySender(
        confession,
        `💖 Confess kamu diterima oleh ${interaction.user.tag}!`
      );

      await sendLog(confession, "Accepted");

      return interaction.update({
        content: "✅ Kamu menerima confess ini.",
        embeds: [],
        components: []
      });
    }

    // DENY
    if (action === "deny") {
      confession.status = "denied";
      confession.respondedBy = interaction.user.id;
      confession.respondedAt = new Date().toISOString();
      saveDb(db);

      await notifySender(
        confession,
        `💔 Confess kamu ditolak oleh ${interaction.user.tag}.`
      );

      await sendLog(confession, "Denied");

      return interaction.update({
        content: "❌ Kamu menolak confess ini.",
        embeds: [],
        components: []
      });
    }

    // DENY + REASON
    if (action === "denyreason") {
      const modal = new ModalBuilder()
        .setCustomId(
          `denyreasonmodal_${confessionId}`
        )
        .setTitle("Alasan Penolakan");

      const reasonInput = new TextInputBuilder()
        .setCustomId("reason")
        .setLabel("Masukkan alasan")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          reasonInput
        )
      );

      return interaction.showModal(modal);
    }
  }

  // ========================================
  // MODAL SUBMIT
  // ========================================
  if (interaction.isModalSubmit()) {
    if (
      !interaction.customId.startsWith(
        "denyreasonmodal_"
      )
    ) {
      return;
    }

    const confessionId =
      interaction.customId.replace(
        "denyreasonmodal_",
        ""
      );

    const confession =
      db.confessions[confessionId];

    if (!confession) {
      return interaction.reply({
        content: "❌ Data confess tidak ditemukan.",
        ephemeral: true
      });
    }

    const reason =
      interaction.fields.getTextInputValue(
        "reason"
      );

    confession.status = "denied_with_reason";
    confession.reason = reason;
    confession.respondedBy =
      interaction.user.id;
    confession.respondedAt =
      new Date().toISOString();

    saveDb(db);

    await notifySender(
      confession,
      `💔 Confess kamu ditolak oleh ${interaction.user.tag}.\n\n📝 Alasan: ${reason}`
    );

    await sendLog(
      confession,
      "Denied with Reason"
    );

    return interaction.reply({
      content:
        "❌ Confess ditolak dengan alasan.",
      ephemeral: true
    });
  }
});

// ==========================================
// KIRIM DM KE PENGIRIM
// ==========================================
async function notifySender(
  confession,
  text
) {
  try {
    const sender =
      await client.users.fetch(
        confession.senderId
      );
    await sender.send(text);
  } catch {
    console.log(
      "⚠️ Gagal mengirim DM ke pengirim."
    );
  }
}

// ==========================================
// LOG CHANNEL
// ==========================================
async function sendLog(
  confession,
  result
) {
  try {
    const logChannel =
      await client.channels
        .fetch(
          process.env.LOG_CHANNEL_ID
        )
        .catch(() => null);

    if (!logChannel) return;

    const embed = new EmbedBuilder()
      .setTitle("📋 Confess Log")
      .addFields(
        {
          name: "Status",
          value: result,
          inline: true
        },
        {
          name: "Anonymous",
          value: confession.anonymous
            ? "Ya"
            : "Tidak",
          inline: true
        },
        {
          name: "Sender",
          value: `${confession.senderTag}\n${confession.senderId}`
        },
        {
          name: "Target",
          value: `${confession.targetTag}\n${confession.targetId}`
        },
        {
          name: "Pesan",
          value: confession.message
        }
      )
      .setTimestamp();

    if (confession.reason) {
      embed.addFields({
        name: "Alasan Penolakan",
        value: confession.reason
      });
    }

    await logChannel.send({
      embeds: [embed]
    });
  } catch {
    console.log("⚠️ Gagal mengirim log.");
  }
}

// ==========================================
// LOGIN
// ==========================================
client.login(process.env.DISCORD_TOKEN);
