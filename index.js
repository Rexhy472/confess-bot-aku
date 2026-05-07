// index.js
import { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import fs from 'fs';
import path from 'path';

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

// Setup lowdb
const file = path.join(process.cwd(), 'db.json');
const adapter = new JSONFile(file);
const db = new Low(adapter);

await db.read();
db.data ||= { confessions: [], replyQueue: [], logs: [] };
await db.write();

// Login bot pakai ENV variable (set DISCORD_TOKEN di Render)
client.login(process.env.DISCORD_TOKEN);

// ======================
// Slash command /confess
// ======================
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'confess') {
        const message = interaction.options.getString('message');
        const showName = interaction.options.getBoolean('show_name');

        const confession = {
            id: db.data.confessions.length + 1,
            serverId: interaction.guild.id,
            senderId: interaction.user.id,
            displayName: interaction.user.username,
            message,
            showName,
            status: 'pending'
        };

        db.data.confessions.push(confession);
        await db.write();

        await interaction.reply({ content: '✅ Confession berhasil dikirim! Menunggu review admin.', ephemeral: true });

        // Kirim ke moderasi channel
        const modChannel = interaction.guild.channels.cache.find(ch => ch.name === 'confess-moderation');
        if (modChannel) {
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId(`approve_${confession.id}`).setLabel('Approve').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`deny_${confession.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId(`denyReason_${confession.id}`).setLabel('Deny with Reason').setStyle(ButtonStyle.Primary)
                );
            await modChannel.send({ content: `Confession #${confession.id}:\n${message}`, components: [row] });
        }
    }
});

// ======================
// Handle buttons
// ======================
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    await db.read();
    const [action, id] = interaction.customId.split('_');
    const confession = db.data.confessions.find(c => c.id == id);
    if (!confession) return interaction.reply({ content: '❌ Confession tidak ditemukan!', ephemeral: true });

    if (action === 'approve') {
        confession.status = 'approved';
        await db.write();

        const confChannel = interaction.guild.channels.cache.find(ch => ch.name === 'confessions');
        if (confChannel) {
            const displayName = confession.showName ? confession.displayName : 'Anonim';
            await confChannel.send(`${displayName}:\n${confession.message}`);
        }

        await interaction.reply({ content: `✅ Confession #${confession.id} telah disetujui!`, ephemeral: true });
        db.data.logs.push({ id: confession.id, senderId: confession.senderId, status: 'approved', admin: 'Admin' });
        await db.write();
    }
    else if (action === 'deny') {
        confession.status = 'denied';
        await db.write();

        await interaction.reply({ content: `❌ Confession #${confession.id} ditolak.`, ephemeral: true });
        db.data.logs.push({ id: confession.id, senderId: confession.senderId, status: 'denied', admin: 'Admin' });
        await db.write();
    }
    else if (action === 'denyReason') {
        const modal = new ModalBuilder()
            .setCustomId(`modal_denyReason_${confession.id}`)
            .setTitle('Deny with Reason');

        const reasonInput = new TextInputBuilder()
            .setCustomId('reasonInput')
            .setLabel('Alasan Penolakan')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
        await interaction.showModal(modal);
    }
});

// ======================
// Handle Modal Submit (Deny with Reason)
// ======================
client.on('interactionCreate', async interaction => {
    if (!interaction.isModalSubmit()) return;

    if (interaction.customId.startsWith('modal_denyReason_')) {
        const id = interaction.customId.split('_')[2];
        await db.read();
        const confession = db.data.confessions.find(c => c.id == id);
        if (!confession) return interaction.reply({ content: '❌ Confession tidak ditemukan!', ephemeral: true });

        const reason = interaction.fields.getTextInputValue('reasonInput');
        confession.status = 'denied_with_reason';
        confession.reason = reason;
        await db.write();

        await interaction.reply({ content: `❌ Confession #${confession.id} ditolak dengan alasan: ${reason}`, ephemeral: true });
        db.data.logs.push({ id: confession.id, senderId: confession.senderId, status: 'denied_with_reason', reason, admin: 'Admin' });
        await db.write();
    }
});
