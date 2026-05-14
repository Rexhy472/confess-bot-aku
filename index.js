require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");
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

const http = require("http");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

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

function generateId() {
  return Date.now();
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

function makeConfessButtons(confessionId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("quick_confess")
      .setLabel("Buat Confess")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId(`reply_${confessionId}`)
      .setLabel("Balas")
      .setStyle(ButtonStyle.Primary)
  );
}

function makeReplyButton(confessionId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`reply_${confessionId}`)
      .setLabel("Balas")
      .setStyle(ButtonStyle.Primary)
  );
}

function makeReviewButtons(id) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`review_accept_${id}`)
      .setLabel("Approve")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId(`review_deny_${id}`)
      .setLabel("Deny")
      .setStyle(ButtonStyle.Danger),

    new ButtonBuilder()
      .setCustomId(`review_denyreason_${id}`)
      .setLabel("Deny + Reason")
      .setStyle(ButtonStyle.Secondary)
  );
}

function makeReplyReviewButtons(id) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`reply_accept_${id}`)
      .setLabel("Approve")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId(`reply_deny_${id}`)
      .setLabel("Deny")
      .setStyle(ButtonStyle.Danger),

    new ButtonBuilder()
      .setCustomId(`reply_denyreason_${id}`)
      .setLabel("Deny + Reason")
      .setStyle(ButtonStyle.Secondary)
  );
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

async function getConfession(id) {
  const { data, error } = await supabase
    .from("confessions")
    .select("*")
    .eq("id", Number(id))
    .single();

  if (error || !data) return null;
  return data;
}

async function getReply(id) {
  const { data, error } = await supabase
    .from("replies")
    .select("*")
    .eq("id", Number(id))
    .single();

  if (error || !data) return null;
  return data;
}

async function deleteReviewMessage(channelId, messageId) {
  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return;

    const message = await channel.messages.fetch(messageId).catch(() => null);
    if (!message) return;

    await message.delete().catch(() => null);
  } catch {
    console.log("⚠️ Gagal menghapus pesan review.");
  }
}

async function getOrCreateThread(parent) {
  if (parent.thread_id) {
    const existingThread = await client.channels
      .fetch(parent.thread_id)
      .catch(() => null);

    if (existingThread) return existingThread;
  }

  const confessChannel = await client.channels
    .fetch(process.env.CONFESS_CHANNEL_ID)
    .catch(() => null);

  if (!confessChannel) return null;

  const publicMessage = await confessChannel.messages
    .fetch(parent.message_id)
    .catch(() => null);

  if (!publicMessage) return null;

  const thread = await publicMessage.startThread({
    name: `Confession Replies #${parent.id}`,
    autoArchiveDuration: 1440
  });

  await supabase
    .from("confessions")
    .update({ thread_id: thread.id })
    .eq("id", Number(parent.id));

  return thread;
}

function createDenyReasonModal(type, id, channelId, messageId) {
  const modal = new ModalBuilder()
    .setCustomId(`denyreasonmodal_${type}_${id}_${channelId}_${messageId}`)
    .setTitle("Alasan Penolakan");

  const reasonInput = new TextInputBuilder()
    .setCustomId("reason")
    .setLabel("Masukkan alasan")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));

  return modal;
}

client.once("clientReady", () => {
  console.log(`✅ Bot online sebagai ${client.user.tag}`);
});

client.on("interactionCreate", async interaction => {
  try {
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
      if (interaction.customId === "quick_confess") {
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

      if (
        interaction.customId === "confess_anon" ||
        interaction.customId === "confess_name"
      ) {
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

        interaction.message?.delete().catch(() => null);
        return interaction.showModal(modal);
      }

      if (interaction.customId.startsWith("review_accept_")) {
        if (!isStaff(interaction.member)) {
          return interaction.reply({
            content: "❌ Kamu bukan staff.",
            ephemeral: true
          });
        }

        await interaction.deferUpdate();

        const id = interaction.customId.replace("review_accept_", "");
        const confession = await getConfession(id);

        if (!confession || confession.status !== "pending") {
          await interaction.message.delete().catch(() => null);
          return;
        }

        const confessChannel = await client.channels
          .fetch(process.env.CONFESS_CHANNEL_ID)
          .catch(() => null);

        if (!confessChannel) return;

        const publicEmbed = new EmbedBuilder()
          .setTitle(
            confession.anonymous
              ? `Anonymous Confession (#${id})`
              : `Confession from ${confession.sender_tag} (#${id})`
          )
          .setDescription(`"${confession.message}"`)
          .addFields({
            name: "Ditujukan kepada",
            value: normalizeTarget(confession.target)
          })
          .setTimestamp();

        applyAttachment(publicEmbed, confession.attachment);

        const sentMessage = await confessChannel.send({
          embeds: [publicEmbed],
          components: [makeConfessButtons(id)]
        });

        await supabase
          .from("confessions")
          .update({
            status: "approved",
            message_id: sentMessage.id,
            thread_id: null,
            approved_by: interaction.user.id,
            approved_by_tag: interaction.user.tag,
            approved_at: new Date().toISOString()
          })
          .eq("id", Number(id));

        await safeDm(
          confession.sender_id,
          `✅ Confess kamu (#${id}) sudah di-approve dan dikirim ke channel confess.`
        );

        await sendLog("✅ Confession Approved", [
          { name: "ID", value: `#${id}`, inline: true },
          { name: "Approved By", value: interaction.user.tag, inline: true },
          { name: "Sender", value: `${confession.sender_tag}\n${confession.sender_id}` },
          { name: "Message", value: confession.message }
        ]);

        await interaction.message.delete().catch(() => null);
        return;
      }

      if (interaction.customId.startsWith("review_denyreason_")) {
        if (!isStaff(interaction.member)) {
          return interaction.reply({
            content: "❌ Kamu bukan staff.",
            ephemeral: true
          });
        }

        const id = interaction.customId.replace("review_denyreason_", "");
        return interaction.showModal(
          createDenyReasonModal(
            "confession",
            id,
            interaction.channelId,
            interaction.message.id
          )
        );
      }

      if (interaction.customId.startsWith("review_deny_")) {
        if (!isStaff(interaction.member)) {
          return interaction.reply({
            content: "❌ Kamu bukan staff.",
            ephemeral: true
          });
        }

        await interaction.deferUpdate();

        const id = interaction.customId.replace("review_deny_", "");
        const confession = await getConfession(id);

        if (!confession || confession.status !== "pending") {
          await interaction.message.delete().catch(() => null);
          return;
        }

        await supabase
          .from("confessions")
          .update({
            status: "denied",
            approved_by: interaction.user.id,
            approved_by_tag: interaction.user.tag,
            approved_at: new Date().toISOString()
          })
          .eq("id", Number(id));

        await safeDm(
          confession.sender_id,
          `❌ Confess kamu (#${id}) ditolak oleh staff.`
        );

        await sendLog("❌ Confession Denied", [
          { name: "ID", value: `#${id}`, inline: true },
          { name: "Denied By", value: interaction.user.tag, inline: true },
          { name: "Sender", value: `${confession.sender_tag}\n${confession.sender_id}` },
          { name: "Message", value: confession.message }
        ]);

        await interaction.message.delete().catch(() => null);
        return;
      }

      if (
        interaction.customId.startsWith("reply_") &&
        !interaction.customId.startsWith("reply_accept_") &&
        !interaction.customId.startsWith("reply_deny_") &&
        !interaction.customId.startsWith("reply_denyreason_")
      ) {
        const confessionId = interaction.customId.replace("reply_", "");
        const confession = await getConfession(confessionId);

        if (!confession || confession.status !== "approved") {
          return interaction.reply({
            content: "❌ Confession ini belum ditemukan.",
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

        await interaction.deferUpdate();

        const replyId = interaction.customId.replace("reply_accept_", "");
        const reply = await getReply(replyId);

        if (!reply || reply.status !== "pending") {
          await interaction.message.delete().catch(() => null);
          return;
        }

        const parent = await getConfession(reply.confession_id);

        if (!parent || !parent.message_id) return;

        const thread = await getOrCreateThread(parent);
        if (!thread) return;

        const replyEmbed = new EmbedBuilder()
          .setTitle(`Anonymous Reply (#${replyId})`)
          .setDescription(`"${reply.message}"`)
          .setTimestamp();

        applyAttachment(replyEmbed, reply.attachment);

        await thread.send({
          embeds: [replyEmbed],
          components: [makeReplyButton(reply.confession_id)]
        });

        await supabase
          .from("replies")
          .update({ status: "approved" })
          .eq("id", Number(replyId));

        await safeDm(
          reply.sender_id,
          `✅ Reply kamu untuk confession #${reply.confession_id} sudah di-approve.`
        );

        await sendLog("✅ Reply Approved", [
          { name: "Reply ID", value: `#${replyId}`, inline: true },
          { name: "Confession ID", value: `#${reply.confession_id}`, inline: true },
          { name: "Approved By", value: interaction.user.tag, inline: true },
          { name: "Sender", value: `${reply.sender_tag}\n${reply.sender_id}` },
          { name: "Reply", value: reply.message }
        ]);

        await interaction.message.delete().catch(() => null);
        return;
      }

      if (interaction.customId.startsWith("reply_denyreason_")) {
        if (!isStaff(interaction.member)) {
          return interaction.reply({
            content: "❌ Kamu bukan staff.",
            ephemeral: true
          });
        }

        const replyId = interaction.customId.replace("reply_denyreason_", "");
        return interaction.showModal(
          createDenyReasonModal(
            "reply",
            replyId,
            interaction.channelId,
            interaction.message.id
          )
        );
      }

      if (interaction.customId.startsWith("reply_deny_")) {
        if (!isStaff(interaction.member)) {
          return interaction.reply({
            content: "❌ Kamu bukan staff.",
            ephemeral: true
          });
        }

        await interaction.deferUpdate();

        const replyId = interaction.customId.replace("reply_deny_", "");
        const reply = await getReply(replyId);

        if (!reply || reply.status !== "pending") {
          await interaction.message.delete().catch(() => null);
          return;
        }

        await supabase
          .from("replies")
          .update({ status: "denied" })
          .eq("id", Number(replyId));

        await safeDm(
          reply.sender_id,
          `❌ Reply kamu (#${replyId}) ditolak oleh staff.`
        );

        await sendLog("❌ Reply Denied", [
          { name: "Reply ID", value: `#${replyId}`, inline: true },
          { name: "Confession ID", value: `#${reply.confession_id}`, inline: true },
          { name: "Denied By", value: interaction.user.tag, inline: true },
          { name: "Sender", value: `${reply.sender_tag}\n${reply.sender_id}` },
          { name: "Reply", value: reply.message }
        ]);

        await interaction.message.delete().catch(() => null);
        return;
      }
    }

    if (interaction.isModalSubmit()) {
      await interaction.deferReply({ ephemeral: true });

      if (interaction.customId.startsWith("confessmodal_")) {
        const anonymous = interaction.customId.endsWith("_anon");

        const id = generateId();
        const target = interaction.fields.getTextInputValue("target");
        const message = interaction.fields.getTextInputValue("confession");
        const attachment =
          interaction.fields.getTextInputValue("attachment") || "";

        const { error } = await supabase.from("confessions").insert({
          id,
          sender_id: interaction.user.id,
          sender_tag: interaction.user.tag,
          anonymous,
          target,
          message,
          attachment,
          status: "pending"
        });

        if (error) {
          console.error(error);
          return interaction.editReply({
            content: "❌ Gagal menyimpan confession ke database."
          });
        }

        const reviewChannel = await client.channels
          .fetch(process.env.REVIEW_CHANNEL_ID)
          .catch(() => null);

        if (!reviewChannel) {
          return interaction.editReply({
            content: "❌ Channel review staff tidak ditemukan."
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
              value: anonymous
                ? "Anonim"
                : `Tampilkan nama: ${interaction.user.tag}`,
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

        await reviewChannel.send({
          embeds: [reviewEmbed],
          components: [makeReviewButtons(id)]
        });

        return interaction.editReply({
          content: `✅ Confession kamu sudah masuk review. Jika di-approve, akan dikirim ke channel confess. (#${id})`
        });
      }

      if (interaction.customId.startsWith("replymodal_")) {
        const confessionId = interaction.customId.replace("replymodal_", "");
        const parent = await getConfession(confessionId);

        if (!parent || parent.status !== "approved") {
          return interaction.editReply({
            content: "❌ Confession utama tidak ditemukan."
          });
        }

        const replyId = generateId();
        const message = interaction.fields.getTextInputValue("reply");
        const attachment =
          interaction.fields.getTextInputValue("attachment") || "";

        const { error } = await supabase.from("replies").insert({
          id: replyId,
          confession_id: Number(confessionId),
          sender_id: interaction.user.id,
          sender_tag: interaction.user.tag,
          message,
          attachment,
          status: "pending"
        });

        if (error) {
          console.error(error);
          return interaction.editReply({
            content: "❌ Gagal menyimpan reply ke database."
          });
        }

        const reviewChannel = await client.channels
          .fetch(process.env.REVIEW_CHANNEL_ID)
          .catch(() => null);

        if (!reviewChannel) {
          return interaction.editReply({
            content: "❌ Channel review staff tidak ditemukan."
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

        await reviewChannel.send({
          embeds: [reviewEmbed],
          components: [makeReplyReviewButtons(replyId)]
        });

        return interaction.editReply({
          content: `✅ Reply kamu sudah masuk review staff. (#${replyId})`
        });
      }

      if (interaction.customId.startsWith("denyreasonmodal_")) {
        const parts = interaction.customId.split("_");
        const type = parts[1];
        const id = parts[2];
        const channelId = parts[3];
        const messageId = parts[4];
        const reason = interaction.fields.getTextInputValue("reason");

        if (type === "confession") {
          const confession = await getConfession(id);

          if (!confession || confession.status !== "pending") {
            await deleteReviewMessage(channelId, messageId);
            return interaction.editReply({
              content: "❌ Data confess tidak ditemukan atau sudah diproses."
            });
          }

          await supabase
            .from("confessions")
            .update({
              status: "denied",
              approved_by: interaction.user.id,
              approved_by_tag: interaction.user.tag,
              approved_at: new Date().toISOString()
            })
            .eq("id", Number(id));

          await safeDm(
            confession.sender_id,
            `❌ Confess kamu (#${id}) ditolak oleh staff.\n\n📝 Alasan: ${reason}`
          );

          await sendLog("❌ Confession Denied With Reason", [
            { name: "ID", value: `#${id}`, inline: true },
            { name: "Denied By", value: interaction.user.tag, inline: true },
            { name: "Reason", value: reason },
            { name: "Sender", value: `${confession.sender_tag}\n${confession.sender_id}` },
            { name: "Message", value: confession.message }
          ]);

          await deleteReviewMessage(channelId, messageId);

          return interaction.editReply({
            content: `❌ Confession #${id} ditolak dengan alasan.`
          });
        }

        if (type === "reply") {
          const reply = await getReply(id);

          if (!reply || reply.status !== "pending") {
            await deleteReviewMessage(channelId, messageId);
            return interaction.editReply({
              content: "❌ Data reply tidak ditemukan atau sudah diproses."
            });
          }

          await supabase
            .from("replies")
            .update({ status: "denied" })
            .eq("id", Number(id));

          await safeDm(
            reply.sender_id,
            `❌ Reply kamu (#${id}) ditolak oleh staff.\n\n📝 Alasan: ${reason}`
          );

          await sendLog("❌ Reply Denied With Reason", [
            { name: "Reply ID", value: `#${id}`, inline: true },
            { name: "Confession ID", value: `#${reply.confession_id}`, inline: true },
            { name: "Denied By", value: interaction.user.tag, inline: true },
            { name: "Reason", value: reason },
            { name: "Sender", value: `${reply.sender_tag}\n${reply.sender_id}` },
            { name: "Reply", value: reply.message }
          ]);

          await deleteReviewMessage(channelId, messageId);

          return interaction.editReply({
            content: `❌ Reply #${id} ditolak dengan alasan.`
          });
        }
      }
    }
  } catch (error) {
    console.error("Interaction error:", error);

    try {
      if (interaction.replied || interaction.deferred) {
        return interaction.followUp({
          content: "❌ Terjadi error saat memproses interaction.",
          ephemeral: true
        });
      }

      return interaction.reply({
        content: "❌ Terjadi error saat memproses interaction.",
        ephemeral: true
      });
    } catch (err) {
      console.error("Gagal mengirim pesan error:", err);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
