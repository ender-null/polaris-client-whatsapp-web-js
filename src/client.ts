/* eslint-disable prefer-const */
import WebSocket from 'ws';
import { Bot } from './bot';
import { WSMessage } from './types';
import { catchException, logger } from './utils';
import { Client, RemoteAuth } from 'whatsapp-web.js';
import QRCode from 'qrcode';
import mongoose from 'mongoose';
import { MongoStore } from 'wwebjs-mongo';

let bot: Bot;
let ws: WebSocket;
let pingInterval;

const close = () => {
  logger.warn(`Close server`);
  ws.terminate();
  process.exit();
};

process.on('SIGINT', () => close());
process.on('SIGTERM', () => close());
process.on('exit', () => {
  logger.warn(`Exit process`);
});

if (!process.env.SERVER || !process.env.MONGODB_URI || !process.env.CONFIG) {
  if (!process.env.SERVER) {
    logger.warn(`Missing env variable SERVER`);
  }
  if (!process.env.CONFIG) {
    logger.warn(`Missing env variable CONFIG`);
  }
  if (!process.env.MONGODB_URI) {
    logger.warn(`Missing env variable MONGODB_URI`);
  }
  close();
}

mongoose.connect(process.env.MONGODB_URI).then(() => {
  const store = new MongoStore({ mongoose: mongoose });
  const client = new Client({
    authStrategy: new RemoteAuth({
      store: store,
      backupSyncIntervalMs: 300000,
    }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--unhandled-rejections=strict'],
    },
  });

  client.on('qr', async (qr_code) => {
    const qr = await QRCode.toString(qr_code, {
      type: 'terminal',
      small: true,
    });
    logger.info(`QR received:\n${qr}`);
  });

  client.on('ready', async () => {
    logger.info('Client is ready!');
    await bot.init();
  });

  client.on('message', async (message) => {
    const msg = await bot.convertMessage(message);
    const data: WSMessage = {
      bot: bot.user.username,
      platform: 'whatsapp',
      type: 'message',
      message: msg,
    };
    ws.send(JSON.stringify(data));
  });

  client.initialize();

  ws = new WebSocket(process.env.SERVER);
  bot = new Bot(ws, client);

  clearInterval(pingInterval);
  pingInterval = setInterval(() => {
    bot.ping();
  }, 30000);

  ws.on('error', async (error: WebSocket.ErrorEvent) => {
    if (error['code'] === 'ECONNREFUSED') {
      logger.info(`Waiting for server to be available...`);
    } else {
      logger.error(error);
    }
  });

  ws.on('open', async () => {
    //await bot.init()
  });

  ws.on('close', async (code) => {
    if (client.pupPage) {
      await client.sendPresenceUnavailable();
    }
    if (code === 1005) {
      logger.warn(`Disconnected`);
    } else if (code === 1006) {
      logger.warn(`Terminated`);
    }
    clearInterval(pingInterval);
    process.exit();
  });

  ws.on('message', (data: string) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type !== 'pong') {
        logger.info(JSON.stringify(msg, null, 4));
      }
      if (msg.type === 'message') {
        bot.sendMessage(msg.message);
      }
    } catch (error) {
      catchException(error);
    }
  });
});
