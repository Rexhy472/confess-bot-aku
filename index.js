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
const http = require("http");

const PORT = process.env.PORT || 3000;

http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Bot is running!");
  })
  .listen(PORT, () => {
    console.log(`🌐 Web server berjalan di port ${PORT}`);
  });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

function loadDb() {
  if (!fs.existsSync("db.json")) {
    fs.writeFileSync(
      "db.json",
      JSON.stringify(
        {
          nextId: 1,
          pending: {},
          confessions: {},
          pendingReplies: {}
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

function getNextId(db) {
  const id = db.nextId || 1;
  db.nextId = id + 1;
  return id;
}

function isStaff(member) {
  if (!member) return false;

  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return true;
  }

  const roleIds = process.env.STAFF_ROLE_IDS
    ?.split(",")
    .map(id => id.trim())
    .filter(Boolean);

  if (!roleIds || roleIds.length === 0) return false;

  return roleIds.some(roleId => member.roles.cache.has(roleId));
}

function normalizeTarget(text) {
  if (!text) return "-";

  const mentionMatch = text.match(/^<@!?(\d+)>$/);
  if (mentionMatch) return `<@${mentionMatch[1]}>`;

  return text;
}

function applyAttachment(embed, attachmentUrl) {
  if (!attachmentUrl) return;

  const url = attachmentUrl.trim();
  if (!url.startsWith("http://") && !url.startsWith("https://")) return;

  const imageRegex = /\.(png|jpg|jpeg|gif|webp)(\?.*)?$/i;

  if (imageRegex.test(url)) {
    embed.setImage(url);
  } else {
    embed.addFields({
      name: "Attachment",
      value: url
    });
  }
}

async function safeDm(userId, text) {
  try {
    const user = await client.users.fetch(userId);
    await user.send(text);
  } catch {
    console.log("⚠️ Gagal mengirim DM.");
  }
}

async function sendLog(title, fields) {
  try {
    const logChannel = await client.channels
      .fetch(process.env.LOG_CHANNEL_ID)
      .catch(() => null);

    if (!logChannel) return;

    const embed = new EmbedBuilder()
      .setTitle(title)
      .addFields(fields)
      .setTimestamp();

    await logChannel.send({ embeds: [embed] });
  } catch {
    console.log("⚠️ Gagal mengirim log.");
  }
}

client.once("clientReady", () => {
  console.log(`✅ Bot online sebagai ${client.user.tag}`);
});

client.on("interactionCreate", async interaction => {
  const db = loadDb();

  if (interaction.isChatInputCommand()) {
    if (interaction.commandName !== "confess") return;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("confess_anon")
        .setLabel("Anonim")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("confess_name")
        .setLabel("Tampilkan Nama")
        .setStyle(ButtonStyle.Primary)
    );

    return interaction.reply({
      content: "Pilih mode confess kamu:",
      components: [row],
      ephemeral: true
    });
  }

  if (interaction.isButton()) {
    if (interaction.customId === "confess_anon" || interaction.customId === "confess_name") {
      const anonymous = interaction.customId === "confess_anon";

      const modal = new ModalBuilder()
        .setCustomId(`confessmodal_${anonymous ? "anon" : "name"}`)
        .setTitle("Submit Confess");

      const targetInput = new TextInputBuilder()
        .setCustomId("target")
        .setLabel("Ditujukan ke siapa?")
        .setPlaceholder("Bisa mention @orang atau tulis bebas")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const confessionInput = new TextInputBuilder()
        .setCustomId("confession")
        .setLabel("Isi confess")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

      const attachmentInput = new TextInputBuilder()
        .setCustomId("attachment")
        .setLabel("Attachment URL (opsional)")
        .setPlaceholder("Link gambar / video / meme")
        .setStyle(TextInputStyle.Short)
        .setRequired(false);

      modal.addComponents(
        new ActionRowBuilder().addComponents(targetInput),
        new ActionRowBuilder().addComponents(confessionInput),
        new ActionRowBuilder().addComponents(attachmentInput)
      );

      return interaction.showModal(modal);
    }

    if (interaction.customId.startsWith("review_accept_")) {
      if (!isStaff(interaction.member)) {
        return interaction.reply({
          content: "❌ Kamu bukan staff.",
          ephemeral: true
        });
      }

      const id = interaction.customId.replace("review_accept_", "");
      const confession = db.pending[id];

      if (!confession) {
        return interaction.reply({
          content: "❌ Data confess tidak ditemukan.",
          ephemeral: true
        });
      }

      const confessChannel = await client.channels
        .fetch(process.env.CONFESS_CHANNEL_ID)
        .catch(() => null);

      if (!confessChannel) {
        return interaction.reply({
          content: "❌ Channel confess publik tidak ditemukan.",
          ephemeral: true
        });
      }

      const publicEmbed = new EmbedBuilder()
        .setTitle(
          confession.anonymous
            ? `Anonymous Confession (#${id})`
            : `Confession from ${confession.senderTag} (#${id})`
        )
        .setDescription(`"${confession.message}"`)
        .addFields({
          name: "Ditujukan kepada",
          value: normalizeTarget(confession.target)
        })
        .setTimestamp();

      applyAttachment(publicEmbed, confession.attachment);

      const replyRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`reply_${id}`)
          .setLabel("Balas")
          .setStyle(ButtonStyle.Primary)
      );

      const sentMessage = await confessChannel.send({
        embeds: [publicEmbed],
        components: [replyRow]
      });

      const thread = await sentMessage.startThread({
        name: `Confession Replies #${id}`,
        autoArchiveDuration: 1440
      });

      db.confessions[id] = {
        ...confession,
        status: "approved",
        approvedBy: interaction.user.id,
        approvedByTag: interaction.user.tag,
        messageId: sentMessage.id,
        threadId: thread.id,
        approvedAt: new Date().toISOString()
      };

      delete db.pending[id];
      saveDb(db);

      await safeDm(
        confession.senderId,
        `✅ Confess kamu (#${id}) sudah di-approve dan dikirim ke channel confess.`
      );

      await sendLog("✅ Confession Approved", [
        { name: "ID", value: `#${id}`, inline: true },
        { name: "Approved By", value: `${interaction.user.tag}`, inline: true },
        { name: "Sender", value: `${confession.senderTag}\n${confession.senderId}` },
        { name: "Message", value: confession.message }
      ]);

      return interaction.update({
        content: `✅ Confession #${id} approved.`,
        embeds: [],
        components: []
      });
    }

    if (interaction.customId.startsWith("review_deny_")) {
      if (!isStaff(interaction.member)) {
        return interaction.reply({
          content: "❌ Kamu bukan staff.",
          ephemeral: true
        });
      }

      const id = interaction.customId.replace("review_deny_", "");
      const confession = db.pending[id];

      if (!confession) {
        return interaction.reply({
          content: "❌ Data confess tidak ditemukan.",
          ephemeral: true
        });
      }

      delete db.pending[id];
      saveDb(db);

      await safeDm(confession.senderId, `❌ Confess kamu (#${id}) ditolak oleh staff.`);

      await sendLog("❌ Confession Denied", [
        { name: "ID", value: `#${id}`, inline: true },
        { name: "Denied By", value: `${interaction.user.tag}`, inline: true },
        { name: "Sender", value: `${confession.senderTag}\n${confession.senderId}` },
        { name: "Message", value: confession.message }
      ]);

      return interaction.update({
        content: `❌ Confession #${id} denied.`,
        embeds: [],
        components: []
      });
    }

    if (interaction.customId.startsWith("reply_")) {
      const confessionId = interaction.customId.replace("reply_", "");
      const confession = db.confessions[confessionId];

      if (!confession) {
        return interaction.reply({
          content: "❌ Confess ini belum ditemukan.",
          ephemeral: true
        });
      }

      const modal = new ModalBuilder()
        .setCustomId(`replymodal_${confessionId}`)
        .setTitle(`Reply Confession #${confessionId}`);

      const replyInput = new TextInputBuilder()
        .setCustomId("reply")
        .setLabel("Isi balasan")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

      const attachmentInput = new TextInputBuilder()
        .setCustomId("attachment")
        .setLabel("Attachment URL (opsional)")
        .setPlaceholder("Link gambar / video / meme")
        .setStyle(TextInputStyle.Short)
        .setRequired(false);

      modal.addComponents(
        new ActionRowBuilder().addComponents(replyInput),
        new ActionRowBuilder().addComponents(attachmentInput)
      );

      return interaction.showModal(modal);
    }

    if (interaction.customId.startsWith("reply_accept_")) {
      if (!isStaff(interaction.member)) {
        return interaction.reply({
          content: "❌ Kamu bukan staff.",
          ephemeral: true
        });
      }

      const replyId = interaction.customId.replace("reply_accept_", "");
      const reply = db.pendingReplies[replyId];

      if (!reply) {
        return interaction.reply({
          content: "❌ Data reply tidak ditemukan.",
          ephemeral: true
        });
      }

      const parent = db.confessions[reply.confessionId];

      if (!parent) {
        return interaction.reply({
          content: "❌ Confess utama tidak ditemukan.",
          ephemeral: true
        });
      }

      const thread = await client.channels.fetch(parent.threadId).catch(() => null);

      if (!thread) {
        return interaction.reply({
          content: "❌ Thread confess tidak ditemukan.",
          ephemeral: true
        });
      }

      const replyEmbed = new EmbedBuilder()
        .setTitle(`Anonymous Reply (#${replyId})`)
        .setDescription(`"${reply.message}"`)
        .setTimestamp();

      applyAttachment(replyEmbed, reply.attachment);

      await thread.send({ embeds: [replyEmbed] });

      delete db.pendingReplies[replyId];
      saveDb(db);

      await safeDm(
        reply.senderId,
        `✅ Reply kamu untuk confession #${reply.confessionId} sudah di-approve.`
      );

      await sendLog("✅ Reply Approved", [
        { name: "Reply ID", value: `#${replyId}`, inline: true },
        { name: "Confession ID", value: `#${reply.confessionId}`, inline: true },
        { name: "Approved By", value: interaction.user.tag, inline: true },
        { name: "Sender", value: `${reply.senderTag}\n${reply.senderId}` },
        { name: "Reply", value: reply.message }
      ]);

      return interaction.update({
        content: `✅ Reply #${replyId} approved.`,
        embeds: [],
        components: []
      });
    }

    if (interaction.customId.startsWith("reply_deny_")) {
      if (!isStaff(interaction.member)) {
        return interaction.reply({
          content: "❌ Kamu bukan staff.",
          ephemeral: true
        });
      }

      const replyId = interaction.customId.replace("reply_deny_", "");
      const reply = db.pendingReplies[replyId];

      if (!reply) {
        return interaction.reply({
          content: "❌ Data reply tidak ditemukan.",
          ephemeral: true
        });
      }

      delete db.pendingReplies[replyId];
      saveDb(db);

      await safeDm(reply.senderId, `❌ Reply kamu (#${replyId}) ditolak oleh staff.`);

      await sendLog("❌ Reply Denied", [
        { name: "Reply ID", value: `#${replyId}`, inline: true },
        { name: "Confession ID", value: `#${reply.confessionId}`, inline: true },
        { name: "Denied By", value: interaction.user.tag, inline: true },
        { name: "Sender", value: `${reply.senderTag}\n${reply.senderId}` },
        { name: "Reply", value: reply.message }
      ]);

      return interaction.update({
        content: `❌ Reply #${replyId} denied.`,
        embeds: [],
        components: []
      });
    }
  }

  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith("confessmodal_")) {
      const anonymous = interaction.customId.endsWith("_anon");

      const id = getNextId(db);
      const target = interaction.fields.getTextInputValue("target");
      const message = interaction.fields.getTextInputValue("confession");
      const attachment = interaction.fields.getTextInputValue("attachment") || "";

      db.pending[id] = {
        id,
        senderId: interaction.user.id,
        senderTag: interaction.user.tag,
        anonymous,
        target,
        message,
        attachment,
        createdAt: new Date().toISOString()
      };

      saveDb(db);

      const reviewChannel = await client.channels
        .fetch(process.env.REVIEW_CHANNEL_ID)
        .catch(() => null);

      if (!reviewChannel) {
        return interaction.reply({
          content: "❌ Channel review staff tidak ditemukan.",
          ephemeral: true
        });
      }

      const reviewEmbed = new EmbedBuilder()
        .setTitle(`Confession Awaiting Review (#${id})`)
        .setDescription(`"${message}"`)
        .addFields(
          {
            name: "Ditujukan kepada",
            value: normalizeTarget(target)
          },
          {
            name: "Mode",
            value: anonymous ? "Anonim" : `Tampilkan nama: ${interaction.user.tag}`,
            inline: true
          },
          {
            name: "Sender ID",
            value: interaction.user.id,
            inline: true
          }
        )
        .setTimestamp();

      applyAttachment(reviewEmbed, attachment);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`review_accept_${id}`)
          .setLabel("Approve")
          .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
          .setCustomId(`review_deny_${id}`)
          .setLabel("Deny")
          .setStyle(ButtonStyle.Danger)
      );

      await reviewChannel.send({
        embeds: [reviewEmbed],
        components: [row]
      });

      return interaction.reply({
        content: `✅ Confession kamu sudah masuk review. Jika di-approve, akan dikirim ke channel confess. (#${id})`,
        ephemeral: true
      });
    }

    if (interaction.customId.startsWith("replymodal_")) {
      const confessionId = interaction.customId.replace("replymodal_", "");
      const parent = db.confessions[confessionId];

      if (!parent) {
        return interaction.reply({
          content: "❌ Confession utama tidak ditemukan.",
          ephemeral: true
        });
      }

      const replyId = getNextId(db);
      const message = interaction.fields.getTextInputValue("reply");
      const attachment = interaction.fields.getTextInputValue("attachment") || "";

      db.pendingReplies[replyId] = {
        id: replyId,
        confessionId,
        senderId: interaction.user.id,
        senderTag: interaction.user.tag,
        message,
        attachment,
        createdAt: new Date().toISOString()
      };

      saveDb(db);

      const reviewChannel = await client.channels
        .fetch(process.env.REVIEW_CHANNEL_ID)
        .catch(() => null);

      if (!reviewChannel) {
        return interaction.reply({
          content: "❌ Channel review staff tidak ditemukan.",
          ephemeral: true
        });
      }

      const reviewEmbed = new EmbedBuilder()
        .setTitle(`Reply Awaiting Review (#${replyId})`)
        .setDescription(`"${message}"`)
        .addFields(
          {
            name: "Untuk Confession",
            value: `#${confessionId}`
          },
          {
            name: "Sender ID",
            value: interaction.user.id
          }
        )
        .setTimestamp();

      applyAttachment(reviewEmbed, attachment);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`reply_accept_${replyId}`)
          .setLabel("Approve")
          .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
          .setCustomId(`reply_deny_${replyId}`)
          .setLabel("Deny")
          .setStyle(ButtonStyle.Danger)
      );

      await reviewChannel.send({
        embeds: [reviewEmbed],
        components: [row]
      });

      return interaction.reply({
        content: `✅ Reply kamu sudah masuk review staff. (#${replyId})`,
        ephemeral: true
      });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
