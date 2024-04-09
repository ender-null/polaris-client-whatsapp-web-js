import WebSocket from 'ws';
import { Conversation, Extra, Message, User, WSInit, WSPing } from './types';
import { Config } from './config';
import { isInt, logger } from './utils';
import { Stream } from 'node:stream';
import WAWebJS, { Client, MessageTypes } from 'whatsapp-web.js';

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
      platform: 'telegram',
      type: 'init',
      user: this.user,
      config,
    };
    this.websocket.send(JSON.stringify(data, null, 4));
    logger.info(`Connected as @${data.user.username}`);
  }

  ping() {
    logger.debug('ping');
    const data: WSPing = {
      bot: this.user.username,
      platform: 'telegram',
      type: 'ping',
    };
    this.websocket.send(JSON.stringify(data, null, 4));
  }

  async convertMessage(msg: WAWebJS.Message) {
    const id: string = msg.id.id;
    const extra: Extra = {
      originalMessage: msg,
    };
    const chat = await msg.getChat();
    const conversation = new Conversation(chat.id.user, chat.name);
    const contact = await msg.getContact();
    const sender = new User(contact.id.user, contact.pushname, null, contact.id.user, false);

    let content;
    let type;

    if (msg.type === MessageTypes.TEXT) {
      content = msg.body;
      type = 'text';
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

  async sendChatAction(msg: WAWebJS.Message, type = 'text'): Promise<void> {
    const chat = await msg.getChat();
    if (type == 'voice' || type == 'audio') {
      chat.sendStateRecording();
    } else if (type == 'cancel') {
      chat.clearState();
    } else {
      chat.sendStateTyping();
    }
  }

  async sendMessage(msg: Message): Promise<WAWebJS.Message> {
    this.sendChatAction(msg.extra.originalMessage, msg.type);
    if (msg.type == 'text') {
      if (!msg.content || (typeof msg.content == 'string' && msg.content.length == 0)) {
        return null;
      }
      let preview = false;
      if (msg.extra && 'preview' in msg.extra) {
        preview = msg.extra.preview;
      }
      this.client.sendMessage(String(msg.conversation.id), msg.content, {
        linkPreview: preview,
        caption: msg.extra?.caption,
      });
    }

    this.sendChatAction(msg.extra.originalMessage, 'cancel');

    return null;
  }

  getInputFile(content: string): string | Stream | Buffer {
    if (content.startsWith('/') || content.startsWith('C:\\')) {
      return Buffer.from(content);
    } else if (content.startsWith('http')) {
      return content;
    } else if (isInt(content)) {
      return content;
    } else {
      return content;
    }
  }
}
