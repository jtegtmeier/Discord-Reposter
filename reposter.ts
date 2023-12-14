import fs from "fs";
import Discord, { Message, TextChannel, Webhook, DMChannel } from "discord.js";

interface Config {
  replacements: Record<string, Record<string, string>>;
  nicknames: Record<string, boolean>;
  prefixes: Record<string, string>;
  active: Record<string, boolean>;
  tags: Record<string, boolean>;
  pins: Record<string, boolean>;
  live: Record<string, { channel: string; hook: boolean }>;
}

const systemMessages = {
	[Discord.MessageType.RecipientAdd]: " added someone to the group.",
	[Discord.MessageType.RecipientRemove]: " removed someone from the group.",
	[Discord.MessageType.Call]: " started a call.",
	[Discord.MessageType.ChannelNameChange]: " changed the name of this channel.",
	[Discord.MessageType.ChannelIconChange]: " changed the icon of this channel.",
	[Discord.MessageType.ChannelPinnedMessage]: " pinned a message to this channel.",
	[Discord.MessageType.UserJoin]: " just joined."
};

export default class Reposter {
  private client: Discord.Client;
  private config: Config;

  constructor(apiKey: string) {
    console.log("LOADING BOT...");
    this.client = new Discord.Client({
      intents: [Discord.GatewayIntentBits.GuildMessages, Discord.GatewayIntentBits.MessageContent],
    });
    this.config = {
      replacements: {},
      nicknames: {},
      prefixes: {},
      active: {},
      tags: {},
      pins: {},
      live: {},
    };
    this.client.login(apiKey).catch(console.error);
    this.client.on("ready", () => {
      const serverCount = this.client.guilds.cache.size;
      this.client.user?.setActivity(`${serverCount} server${serverCount === 1 ? "" : "s"}`, {
        type: Discord.ActivityType.Watching,
      });
      console.log("READY FOR ACTION!");
    });
    this.loadConfig();
  }

  private updateConfig() {
    fs.writeFileSync("config.json", JSON.stringify(this.config, undefined, "\t"));
  }

  private loadConfig() {
    if (fs.existsSync("config.json")) {
      const fileContent = fs.readFileSync("config.json", "utf8");
      this.config = JSON.parse(fileContent);
    } else {
      this.updateConfig();
    }
  }

  private updateStatus() {
    const repostCount = Object.keys(this.config.active).length;
    this.client.user?.setActivity(`${repostCount} repost${repostCount === 1 ? "" : "s"}`, {
      type: Discord.ActivityType.Watching,
    });
  }

  private capitalizeFirst(str: string) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  private inactive(to: TextChannel, from?: TextChannel) {
    return from ? !this.config.active[from.id] : !this.config.active[to.id];
  }

  private replaceAll(channel: TextChannel, str: string) {
    const replace = this.config.replacements[(channel.guild || channel).id];
    if (replace) {
      let replaced = str;
      for (let find in replace) {
        const regex = new RegExp(find, "g");
        replaced = replaced.replace(regex, replace[find]);
      }
      return replaced;
    } else {
      return str;
    }
  }

  private async send(
    channel: TextChannel,
    content: string,
    reactions: Discord.Collection<string, Discord.MessageReaction>
  ) {
    if (this.inactive(channel)) return;
    const sent = await channel.send(content).catch(console.error);
    if (sent && reactions.size) {
      for (const reaction of reactions.values()) {
        if (this.inactive(channel)) break;
        const emoji = reaction.emoji;
        if (emoji.id === null || channel.client.emojis.cache.has(emoji.id)) {
          await sent.react(emoji).catch(console.error);
        }
      }
    }
  }

  private replaceEmbedText(embed: Discord.Embed, channel: TextChannel) {
    let replacedEmbed = new Discord.EmbedBuilder(embed.data);
    if (embed.author) {
      replacedEmbed.setAuthor({
        name: this.replaceAll(channel, embed.author.name),
        iconURL: embed.author.iconURL,
        url: embed.author.url,
      });
    }
    if (embed.description) {
      replacedEmbed.setDescription(this.replaceAll(channel, embed.description));
    }
    if (embed.footer) {
      replacedEmbed.setFooter({
        text: this.replaceAll(channel, embed.footer.text),
        iconURL: embed.footer.iconURL,
      });
    }
    if (embed.title) {
      replacedEmbed.setTitle(this.replaceAll(channel, embed.title));
    }
    return replacedEmbed;
  }

  private setBoolean(channel: TextChannel, key: keyof Config, value: string) {
    const guild = (channel.guild || channel).id;
    const enabled = this.config[key][guild];
    const property = this.capitalizeFirst(key);
    if (
      value &&
      value.match(
        /1|true|yes|confirm|agree|enable|on|positive|accept|ye|yep|ya|yah|yeah|sure|ok|okay/
      )
    ) {
      this.config[key][guild] = true;
      channel.send(`✅ **${property} on!**`).catch(console.error);
    } else if (
      value &&
      value.match(
        /0|false|no|deny|denied|disagree|disable|off|negative|-1|nah|na|nope|stop|end|cease/
      )
    ) {
      this.config[key][guild] = false;
      channel.send(`❌ **${property} off!**`).catch(console.error);
    } else {
      this.config[key][guild] = !enabled;
      channel
        .send(`${enabled ? "❌" : "✅"} **${property} toggled ${enabled ? "off" : "on"}!**`)
        .catch(console.error);
    }
    this.updateConfig();
  }

  private async niceName(
    to: TextChannel | DMChannel,
    from: TextChannel | DMChannel,
    user: Discord.User
  ) {
    const guild = ((from instanceof TextChannel && from.guild) || to).id;
    if (this.config.nicknames[guild] && from instanceof TextChannel) {
      // const member = from.guild.member(user)
      const member = await from.guild.members.fetch({ user: user });
      if (member) {
        return member.displayName;
      } else if (this.config.tags[guild]) {
        return user.tag;
      } else {
        return user.username;
      }
    } else if (this.config.tags[guild]) {
      return user.tag;
    } else {
      return user.username;
    }
  }

  private setPrefix(channel: TextChannel, prefix: string) {
    const guild = (channel.guild || channel).id;
    const previous = this.config.prefixes[guild] || "/";
    if (prefix) {
      this.config.prefixes[guild] = prefix;
      channel
        .send(`**Changed prefix from \`${previous}\` to \`${prefix}\`!**`)
        .catch(console.error);
      this.updateConfig();
    } else {
      channel
        .send(`**Missing \`prefix\` argument! \`${previous}repost prefix <PREFIX>\`**`)
        .catch(console.error);
    }
  }

  private setReplacement(channel: TextChannel, find: string, replace: string) {
    const guild = (channel.guild || channel).id;
    const prefix = this.config.prefixes[guild] || "/";
    this.config.replacements[guild] = this.config.replacements[guild] || {};
    if (find && replace) {
      this.config.replacements[guild][find] = replace;
      channel.send(`**Replacing \`${find}\` with \`${replace}\`!**`).catch(console.error);
      this.updateConfig();
    } else if (find) {
      const replacement = this.config.replacements[guild][find];
      if (replacement) {
        channel.send(`**\`${find}\` is replaced with \`${replacement}\`**`).catch(console.error);
      } else {
        channel
          .send(`**Missing \`replace\` argument! \`${prefix}repost replace ${find} <REPLACE>\`**`)
          .catch(console.error);
      }
    } else {
      channel
        .send(
          `**Missing \`find\` and \`replace\` arguments! \`${prefix}repost replace <FIND> <REPLACE>\`**`
        )
        .catch(console.error);
    }
  }

  private async sendReplacements(channel: TextChannel, id: string) {
    const replace = this.config.replacements[(channel.guild || channel).id];
    if (replace) {
      const size = Object.keys(replace).length;
      const count = await channel
        .send(`**This channel has ${size} replacement${size === 1 ? "" : "s"}!**`)
        .catch(console.error);
      for (let find in replace) {
        const message = await channel
          .send(`\`${find}\` is replaced with \`${replace[find]}\``)
          .catch(console.error);
        if (message) {
          await message.react("❌").catch(console.error);
          message
            .awaitReactions({
              filter: (reaction, user) => user.id === id && reaction.emoji.name === "❌",
              max: 1,
            })
            .then(function () {
              delete replace[find];
              message.delete().catch(console.error);
              this.updateConfig();
              const newSize = Object.keys(replace).length;
              if (count) {
                count
                  .edit(`**This channel has ${newSize} replacement${newSize === 1 ? "" : "s"}!**`)
                  .catch(console.error);
              }
            });
        }
      }
    } else {
      channel.send("**This channel has no replacements!**").catch(console.error);
    }
  }

  private async sendInfo(to: TextChannel | DMChannel, from: TextChannel | DMChannel) {
    const rich = new Discord.EmbedBuilder();
    if (from instanceof TextChannel) {
      rich.setTitle(from.name || from.id);
      rich.setDescription(from.topic || "No topic");
    } else {
      rich.setTitle(from.id);
      rich.setDescription("No topic");
    }
    rich.setFooter({
      text: `Reposting from ${from.id}`,
      iconURL: to.client.user.displayAvatarURL(),
    });
    if (from instanceof TextChannel && from.guild) {
      rich.setAuthor({ name: from.guild.name, iconURL: from.guild.iconURL() || undefined });
      rich.setThumbnail(from.guild.iconURL());
    } else if (from instanceof DMChannel && from.recipient) {
      rich.setAuthor({
        name: await this.niceName(to, from, from.recipient),
        iconURL: from.recipient.displayAvatarURL(),
      });
      rich.setThumbnail(from.recipient.displayAvatarURL());
    }
    rich.setTimestamp();
    if (from instanceof TextChannel) {
      rich.addFields(
        { name: "Channel Category", value: from.parent?.name || "", inline: true },
        { name: "NSFW Channel", value: String(from.nsfw) || "false", inline: true },
        { name: "Server ID", value: String(from.guild.id), inline: true },
        {
          name: "Server Owner",
          value: String(await this.niceName(to, from, (await from.guild.fetchOwner()).user)),
          inline: true,
        },
        { name: "Server Region", value: String(from.guild.preferredLocale), inline: true },
        { name: "Server Members", value: String(from.guild.memberCount), inline: true },
        { name: "Server Roles", value: String(from.guild.roles.cache.size), inline: true },
        { name: "Server Emojis", value: String(from.guild.emojis.cache.size), inline: true },
        { name: "Server Verification", value: String(from.guild.verificationLevel), inline: true },
        { name: "Server Creation Date", value: String(from.guild.createdAt), inline: true },
        { name: "Server Creation Time", value: String(from.guild.createdTimestamp), inline: true }
      );
      const channels = new Map();
      for (const channel of from.guild.channels.cache.values()) {
        channels.set(channel.type, (channels.get(channel.type) || 0) + 1);
      }
      for (const channel of channels.entries()) {
        rich.addFields({
          name: `${this.capitalizeFirst(channel[0])} Channels`,
          value: channel[1],
          inline: true,
        });
      }
      if (from.guild.systemChannel) {
        rich.addFields(
          { name: "Default Channel", value: from.guild.systemChannel.name, inline: true },
          { name: "Default Channel ID", value: String(from.guild.systemChannelId), inline: true }
        );
      }
    }
    rich.addFields(
      { name: "Channel ID", value: String(from.id), inline: true },
      { name: "Channel Type", value: String(from.type), inline: true },
      { name: "Channel Creation Date", value: String(from.createdAt), inline: true },
      { name: "Channel Creation Time", value: String(from.createdTimestamp), inline: true }
    );
    return to.send({ embeds: [rich] }).catch(console.error);
  }

  private async sendMessage(
    message: Message,
    channel: TextChannel | Webhook,
    webhook?: Webhook,
    author?: string
  ) {
    if (this.inactive(channel as TextChannel, message.channel as TextChannel)) return;
    if (message.type !== Discord.MessageType.Default) {
      await channel
        .send(
          `**${this.replaceAll(
            channel as TextChannel,
            await this.niceName(
              channel as TextChannel,
              message.channel as TextChannel,
              message.author
            )
          )}${systemMessages[message.type]}**`
        )
        .catch(console.error);
    } else if (message.author.id !== author) {
      if (webhook) {
        await webhook
          .edit({
            name: this.replaceAll(
              channel as TextChannel,
              await this.niceName(
                channel as TextChannel,
                message.channel as TextChannel,
                message.author
              )
            ),
            avatar: message.author.displayAvatarURL()
          })
          .catch(console.error);
      } else {
        await channel
          .send(
            `**${this.replaceAll(
              channel as TextChannel,
              await this.niceName(
                channel as TextChannel,
                message.channel as TextChannel,
                message.author
              )
            )}**`
          )
          .catch(console.error);
      }
    }
    if (message.content) {
      await this.send(
        channel as TextChannel,
        this.replaceAll(channel as TextChannel, message.content),
        message.reactions
      );
    }
    if (message.attachments.size) {
      for (const attachment of message.attachments.values()) {
        await this.send(
          channel as TextChannel,
          attachment.filesize > 8000000 ? attachment.url : { files: [attachment.url] },
          message.reactions
        );
      }
    }
    if (message.embeds.length) {
      for (let i = 0; i < message.embeds.length; i++) {
        const embed = message.embeds[i];
        if (embed.type === "rich") {
          await this.send(
            channel as TextChannel,
            this.replaceEmbedText(embed, channel as TextChannel),
            message.reactions
          );
        }
      }
    }
  }

  private async sendMessages(
    messages: Discord.Collection<string, Message>,
    channel: TextChannel | Webhook,
    webhook?: Webhook,
    author?: string
  ) {
    if (this.inactive(channel as TextChannel)) return;
    let last;
    if (messages && messages.size) {
      const backward = messages.array().reverse();
      for (let i = 0; i < backward.length; i++) {
        if (this.inactive(channel as TextChannel)) break;
        await this.sendMessage(backward[i], channel, webhook, last ? last.author.id : author);
        last = backward[i];
      }
    }
  }

  private async fetchMessages(
    message: Message,
    channel: TextChannel | Webhook,
    webhook?: Webhook,
    author?: string
  ) {
    if (this.inactive(channel as TextChannel, message.channel as TextChannel)) return;
    const messages = await message.channel.messages
      .fetch({ limit: 100, after: message.id })
      .catch(async function () {
        await channel.send("**Couldn't fetch messages!**").catch(console.error);
      });
    if (this.inactive(channel as TextChannel, message.channel as TextChannel)) return;
    if (messages && messages.size) {
      await this.sendMessages(messages, channel, webhook, author);
      const last = messages.last();
      await this.fetchMessages(last, channel, webhook, last.author.id);
    } else {
      await channel.send("**Repost Complete!**").catch(console.error);
    }
  }

  private async fetchWebhook(channel: TextChannel) {
    const webhooks = await channel.fetchWebhooks().catch(async function () {
      await channel.send("**Can't read webhooks!**").catch(console.error);
    });
    if (webhooks) {
      for (const webhook of webhooks.values()) {
        if (webhook.owner.id === channel.client.user?.id) {
          return webhook;
        }
      }
      return channel
        .createWebhook("Reposter", {
          avatar: channel.client.user?.displayAvatarURL(),
          reason: "Reposting",
        })
        .catch(console.error);
    }
  }

  public async repost(
    id: string,
    message: Message,
    webhook?: boolean,
    direction?: boolean,
    live?: boolean
  ) {
    const channel = id && id.id ? id : await message.client.channels.fetch(id).catch(() => null);
    const dir = direction ? "from" : "to";
    if (!channel) {
      const guild = await message.client.guilds.fetch(id).catch(() => null);
      if (guild) {
        this.config.active[message.channel.id] = true;
        this.updateStatus(message.client);
        await message.channel
          .send(`**Reposting${live ? " live " : " "}${dir} \`${guild.name || id}\`!**`)
          .catch(console.error);
        for (const match of guild.channels.cache.values()) {
          if (this.inactive(message.channel as TextChannel)) break;
          this.config.active[match.id] = true;
          this.updateStatus(message.client);
          this.updateConfig();
          await this.repost(match, message, webhook, direction, live);
        }
      } else if (message.mentions.channels.size) {
        await this.repost(message.mentions.channels.first(), message, webhook, direction, live);
      } else {
        const matches = [];
        for (const match of message.client.channels.cache.values()) {
          if (id === match.name) {
            matches.push(match);
          }
        }
        if (matches.length) {
          if (matches.length === 1) {
            await this.repost(matches[0], message, webhook, direction, live);
          } else {
            await message.channel
              .send(`**Found ${matches.length} channels!**`)
              .catch(console.error);
            for (let i = 0; i < matches.length; i++) {
              const match = matches[i];
              const rich = new Discord.MessageEmbed();
              rich.setFooter(
                `${this.capitalizeFirst(match.type)} Channel`,
                message.client.user?.displayAvatarURL()
              );
              if (match.guild) {
                rich.setAuthor(match.name, match.guild.iconURL());
              } else if (match.recipient) {
                rich.setAuthor(
                  await this.niceName(message.channel as TextChannel, match, match.recipient),
                  match.recipient.displayAvatarURL()
                );
              } else {
                rich.setAuthor(match.name, match.iconURL());
              }
              rich.setTimestamp(match.createdAt);
              rich.addField("Channel ID", `\`${match.id}\``, false);
              const embed = await message.channel.send(rich).catch(console.error);
              await embed.react("✅").catch(console.error);
              embed
                .awaitReactions(
                  (reaction, user) => user.id === message.author.id && reaction.emoji.name === "✅",
                  { max: 1 }
                )
                .then(async function () {
                  await this.repost(match, message, webhook, direction, live);
                });
            }
          }
        } else {
          await message.channel.send(`**Couldn't repost ${dir} \`${id}\`!**`).catch(console.error);
        }
      }
    } else if (channel.id === message.channel.id) {
      await message.channel.send(`**Can't repost ${dir} the same channel!**`).catch(console.error);
    } else if (!channel.type.match(/text|group|dm/)) {
      await message.channel
        .send(`**Can't repost ${dir} ${channel.type} channels!**`)
        .catch(console.error);
    } else if (webhook && (direction ? message.channel.type : channel.type) === "dm") {
      await message.channel.send("**Can't create webhooks on DM channels!**").catch(console.error);
    } else if (
      channel.type === "text" &&
      !direction &&
      !(channel as TextChannel).permissionsFor(message.client.user!).has("SEND_MESSAGES")
    ) {
      await message.channel
        .send(`**Can't repost to \`${channel.name || id}\` without permission!**`)
        .catch(console.error);
    } else {
      const to = direction ? message.channel : channel;
      const from = direction ? channel : message.channel;
      this.config.active[(to as TextChannel).id] = true;
      this.config.active[(from as TextChannel).id] = true;
      this.updateStatus(message.client);
      this.updateConfig();
      await message.channel
        .send(`**Reposting${live ? " live " : " "}${dir} \`${channel.name || id}\`!**`)
        .catch(console.error);
      if (live) {
        this.config.live[(from as TextChannel).id] = {
          channel: (to as TextChannel).id,
          hook: webhook,
        };
        this.updateConfig();
      } else {
        await this.sendInfo(to as TextChannel, from as TextChannel);
        if (this.inactive(to as TextChannel, from as TextChannel)) return;
        const hook = webhook && (await this.fetchWebhook(to as TextChannel));
        if (this.config.pins[(to as TextChannel).guild!.id]) {
          await (to as TextChannel).send("__**Pins**__").catch(console.error);
          const pins = await (from as TextChannel).messages.fetchPinned().catch(async function () {
            await (to as TextChannel).send("**Can't read pins!**").catch(console.error);
          });
          await this.sendMessages(pins, to as TextChannel, hook);
        }
        if (this.inactive(to as TextChannel, from as TextChannel)) return;
        await (to as TextChannel).send("__**Messages**__").catch(console.error);
        const messages = await (from as TextChannel).messages
          .fetch({ limit: 1, after: "0" })
          .catch(async function () {
            await (to as TextChannel).send("**Can't read messages!**").catch(console.error);
          });
        const first = messages && messages.first();
        if (first) {
          await this.sendMessage(first, to as TextChannel, hook);
          await this.fetchMessages(first, to as TextChannel, hook, first.author.id);
        } else {
          await (to as TextChannel).send("**Repost Complete!**").catch(console.error);
        }
      }
    }
  }

  public async repostLive(message: Message) {
    const live =
      this.config.live[(message.channel as TextChannel).id] ||
      this.config.live[(message.guild as Discord.Guild).id];
    if (live) {
      const channel = await message.client.channels.fetch(live.channel).catch(() => null);
      const hook = live.hook && (await this.fetchWebhook(channel as TextChannel));
      await this.sendMessage(message, channel as TextChannel | Webhook, hook);
    }
  }

  private async sendCommands(channel: TextChannel) {
    const prefix = this.config.prefixes[(channel.guild || channel).id] || "/";
    const rich = new Discord.EmbedBuilder();
    rich.setTitle("Reposter Commands");
    rich.setDescription("By MysteryPancake");
    rich.setFooter(this.client.user?.id, this.client.user?.displayAvatarURL());
    rich.setAuthor(
      await this.niceName(channel, channel, this.client.user),
      this.client.user.displayAvatarURL(),
      "https://github.com/MysteryPancake/Discord-Reposter"
    );
    rich.setThumbnail(this.client.user.displayAvatarURL());
    rich.setTimestamp();
    rich.setURL("https://github.com/MysteryPancake/Discord-Reposter#commands");
    rich.addField(
      "Repost To",
      `*Reposts to a channel.*\`\`\`${prefix}repost <CHANNEL>\n${prefix}repost to <CHANNEL>\`\`\``,
      false
    );
    rich.addField(
      "Repost From",
      `*Reposts from a channel.*\`\`\`${prefix}repost from <CHANNEL>\`\`\``,
      false
    );
    rich.addField(
      "Repost Webhook",
      `*Reposts through a webhook.*\`\`\`${prefix}reposthook\n${prefix}repostwebhook\`\`\`Instead of:\`\`\`${prefix}repost\`\`\``,
      false
    );
    rich.addField(
      "Repost Live",
      `*Reposts messages as they come.*\`\`\`${prefix}repostlive\n${prefix}repostlivehook\`\`\`Instead of:\`\`\`${prefix}repost\`\`\``,
      false
    );
    rich.addField(
      "Repost Stop",
      `*Stops reposting.*\`\`\`${prefix}repost stop\n${prefix}repost halt\n${prefix}repost cease\n${prefix}repost terminate\n${prefix}repost suspend\n${prefix}repost cancel\n${prefix}repost die\n${prefix}repost end\`\`\``,
      false
    );
    rich.addField(
      "Repost Commands",
      `*Posts the command list.*\`\`\`${prefix}repost help\n${prefix}repost commands\`\`\``,
      false
    );
    rich.addField(
      "Repost Replace",
      `*Replaces text when reposting.*\`\`\`${prefix}repost replace <FIND> <REPLACE>\`\`\``,
      false
    );
    rich.addField(
      "Repost Replacements",
      `*Posts the replacement list.*\`\`\`${prefix}repost replacements\`\`\``,
      false
    );
    rich.addField(
      "Repost Prefix",
      `*Changes the bot prefix.*\`\`\`${prefix}repost prefix <PREFIX>\`\`\``,
      false
    );
    rich.addField(
      "Repost Tags",
      `*Toggles user tags when reposting.*\`\`\`${prefix}repost tags\n${prefix}repost tags <STATE>\`\`\``,
      false
    );
    rich.addField(
      "Repost Nicknames",
      `*Toggles nicknames when reposting.*\`\`\`${prefix}repost nicknames\n${prefix}repost nicknames <STATE>\`\`\``,
      false
    );
    rich.addField(
      "Repost Pins",
      `*Toggles pins when reposting.*\`\`\`${prefix}repost pins\n${prefix}repost pins <STATE>\`\`\``,
      false
    );
    rich.addField("Channel ID", `\`\`\`${channel.id}\`\`\``, false);
    channel.send(rich).catch(console.error);
  }

  private stop(channel: TextChannel) {
    delete this.config.active[channel.id];
    delete this.config.live[channel.id];
    this.updateStatus();
    this.updateConfig();
    channel.send("**Reposting Terminated!**").catch(console.error);
  }

  public run() {
    this.client.on("message", (message) => {
      this.repostLive(message);
      if (message.author.bot) return;
      const args = message.content.toLowerCase().split(" ");
      const prefix = this.config.prefixes[(message.guild || message.channel).id] || "/";
      if (args[0].startsWith(`${prefix}repost`)) {
        switch (args[1]) {
          case undefined:
          case "help":
          case "commands":
            this.sendCommands(message.channel as TextChannel);
            break;
          case "replacements":
            this.sendReplacements(message.channel as TextChannel, message.author.id);
            break;
          case "replace":
            this.setReplacement(message.channel as TextChannel, args[2], args[3]);
            break;
          case "prefix":
            this.setPrefix(message.channel as TextChannel, args[2]);
            break;
          case "tags":
          case "nicknames":
          case "pins":
            this.setBoolean(message.channel as TextChannel, args[1], args[2]);
            break;
          case "stop":
          case "halt":
          case "cease":
          case "terminate":
          case "suspend":
          case "cancel":
          case "die":
          case "end":
            this.stop(message.channel as TextChannel);
            break;
          default:
            const last = args[2];
            if (last) {
              this.repost(
                last,
                message,
                args[0].indexOf("hook") !== -1,
                args[1] === "from",
                args[0].indexOf("live") !== -1
              );
            } else {
              this.repost(
                args[1],
                message,
                args[0].indexOf("hook") !== -1,
                false,
                args[0].indexOf("live") !== -1
              );
            }
            break;
        }
      }
    });
  }
}
