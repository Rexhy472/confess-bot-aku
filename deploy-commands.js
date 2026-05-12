require("dotenv").config();

const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("confess")
    .setDescription("Kirim confess ke seseorang")
    .addUserOption(option =>
      option
        .setName("target")
        .setDescription("Pilih target confess")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("pesan")
        .setDescription("Isi pesan confess")
        .setRequired(true)
    )
    .addBooleanOption(option =>
      option
        .setName("anonim")
        .setDescription("Kirim secara anonim?")
        .setRequired(true)
    )
    .toJSON()
];

const rest = new REST({ version: "10" }).setToken(
  process.env.DISCORD_TOKEN
);

(async () => {
  try {
    console.log("⏳ Deploying slash commands...");

    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      { body: commands }
    );

    console.log("✅ Slash commands berhasil di-deploy!");
  } catch (error) {
    console.error("❌ Gagal deploy command:", error);
  }
})();
