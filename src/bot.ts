/* eslint-disable @typescript-eslint/no-explicit-any */
import WebSocket from 'ws';
import WAWebJS, { Client, MessageMedia, MessageTypes } from 'whatsapp-web.js';
import { FileResult } from 'tmp';
import { Conversation, Extra, Message, User, WSInit, WSPing } from './types';
import { Config } from './config';
import { fromBase64, htmlToMarkdown, logger } from './utils';

export class Bot {
  user: User;
  websocket: WebSocket;
  client: Client;

  constructor(websocket: WebSocket, client: Client) {
    this.websocket = websocket;
    this.client = client;
  }

  async init() {
    const me = this.client.info;
    this.user = {
      id: me.wid.user,
      firstName: me.pushname,
      lastName: null,
      username: me.wid.user,
      isBot: false,
    };
    const config: Config = JSON.parse(process.env.CONFIG);
    const data: WSInit = {
      bot: this.user.username,
      platform: 'whatsapp',
      type: 'init',
      user: this.user,
      config,
    };
    await this.client.sendPresenceAvailable();
    await this.client.setStatus(`${config.prefix}help`);
    this.websocket.send(JSON.stringify(data, null, 4));
    logger.info(`Connected as @${data.user.username}`);
  }

  ping() {
    logger.debug('ping');
    const data: WSPing = {
      bot: this.user?.username,
      platform: 'whatsapp',
      type: 'ping',
    };
    this.websocket.send(JSON.stringify(data, null, 4));
  }

  async convertMessage(msg: WAWebJS.Message) {
    await this.client.sendPresenceAvailable();
    const id: string = msg.id._serialized;
    const extra: Extra = {
      // originalMessage: msg,
    };
    const chat = await msg.getChat();
    const contact = await msg.getContact();
    chat.sendSeen();

    const conversation = chat.isGroup
      ? new Conversation(`-${chat.id.user}`, chat.name)
      : new Conversation(chat.id.user, contact.pushname);
    const sender = new User(contact.id.user, contact.pushname, null, contact.id.user, false);
    let content;
    let type;

    if (msg.type === MessageTypes.TEXT) {
      content = msg.body;
      type = 'text';
      if (msg.mentionedIds.length) {
        extra.mentions = msg.mentionedIds;
      }
    } else if (msg.type === MessageTypes.IMAGE) {
      const media = await msg.downloadMedia();
      content = media.filename;
      type = 'photo';
    } else if (msg.type === MessageTypes.DOCUMENT) {
      const media = await msg.downloadMedia();
      content = media.filename;
      type = 'document';
    } else if (msg.type === MessageTypes.AUDIO) {
      const media = await msg.downloadMedia();
      content = media.filename;
      type = 'audio';
    } else if (msg.type === MessageTypes.VIDEO) {
      const media = await msg.downloadMedia();
      content = media.filename;
      if (msg.isGif) {
        type = 'animation';
      } else {
        type = 'video';
      }
    } else if (msg.type === MessageTypes.VOICE) {
      const media = await msg.downloadMedia();
      content = media.filename;
      type = 'voice';
    } else if (msg.type === MessageTypes.STICKER) {
      const media = await msg.downloadMedia();
      content = media.filename;
      type = 'sticker';
    } else {
      type = 'unsupported';
    }
    let reply: Message = null;
    if (msg.hasQuotedMsg) {
      const quotedMsg = await msg.getQuotedMessage();
      reply = await this.convertMessage(quotedMsg);
    }

    const date = msg.timestamp;
    return new Message(id, conversation, sender, content, type, date, reply, extra);
  }

  formatChatId(conversationId: number | string) {
    return String(conversationId).startsWith('-')
      ? `${String(conversationId).slice(1)}@g.us`
      : `${conversationId}@c.us`;
  }

  async sendChatAction(conversationId: number | string, type = 'text'): Promise<void> {
    const chatId = this.formatChatId(conversationId);
    const chat = await this.client.getChatById(chatId);
    if (type == 'voice' || type == 'audio') {
      chat.sendStateRecording();
    } else if (type == 'cancel') {
      chat.clearState();
    } else {
      chat.sendStateTyping();
      chat.sendSeen();
    }
  }

  async sendMessage(msg: Message): Promise<WAWebJS.Message> {
    await this.client.sendPresenceAvailable();
    this.sendChatAction(msg.conversation.id, msg.type);
    const chatId = this.formatChatId(msg.conversation.id);

    let caption = msg.extra?.caption;
    if (msg.extra && msg.extra.format && msg.extra.format === 'HTML') {
      caption = htmlToMarkdown(msg.extra?.caption);
    }
    caption = caption?.trim();
    const quotedMessageId = msg.reply ? String(msg.reply.id) : null;

    if (msg.type == 'text') {
      if (!msg.content || (typeof msg.content == 'string' && msg.content.length == 0)) {
        return null;
      }
      let preview = false;
      if (msg.extra && 'preview' in msg.extra) {
        preview = msg.extra.preview;
      }
      let text = msg.content;
      if (msg.extra && msg.extra.format && msg.extra.format === 'HTML') {
        text = htmlToMarkdown(text);
      }
      text = text.trim();
      const result = text.matchAll(/@\d+/gim);
      const mentionsFound = [...result][0];
      const mentions: any[] = mentionsFound?.map((mention) => `${mention.slice(1)}@c.us`);
      this.client.sendMessage(chatId, text, {
        linkPreview: preview,
        mentions: mentions,
        quotedMessageId,
      });
    } else if (msg.type == 'photo') {
      this.client.sendMessage(chatId, await this.getInputFile(msg.content), {
        caption,
        quotedMessageId,
      });
    }
    this.sendChatAction(msg.conversation.id, 'cancel');
    return null;
  }

  async getInputFile(content: string): Promise<WAWebJS.MessageMedia> {
    if (content.startsWith('/')) {
      const file: FileResult = await fromBase64(content);
      return MessageMedia.fromFilePath(file.name);
    } else if (content.startsWith('http')) {
      return await MessageMedia.fromUrl(content, { unsafeMime: true });
    } else {
      return content;
    }
  }
}
