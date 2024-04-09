/* eslint-disable prefer-const */
import WebSocket from 'ws';
import { Bot } from './bot';
import { WSMessage } from './types';
import { catchException, logger } from './utils';
import { Client, RemoteAuth } from 'whatsapp-web.js';
import { MongoStore } from 'wwebjs-mongo';
import mongoose from 'mongoose';

let bot: Bot;
let ws: WebSocket;
let pingInterval;

logger.debug(`SERVER: ${process.env.SERVER}`);
logger.debug(`CONFIG: ${process.env.CONFIG}`);

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

mongoose.connect(process.env.MONGODB_URI).then(() => {
  const store = new MongoStore({ mongoose: mongoose });
  const client = new Client({
    authStrategy: new RemoteAuth({
      store: store,
      backupSyncIntervalMs: 300000,
    }),
    // proxyAuthentication: { username: 'username', password: 'password' },
    puppeteer: {
      // args: ['--proxy-server=proxy-server-that-requires-authentication.example.com'],
      headless: false,
    },
  });

  client.on('qr', (qr) => {
    // Generate and scan this code with your phone
    logger.info('QR RECEIVED');
    logger.info(qr);
  });

  client.on('ready', async () => {
    logger.info('Client is ready!');
    await bot.init();
  });

  client.on('message', async (message) => {
    const msg = await bot.convertMessage(message);
    const data: WSMessage = {
      bot: bot.user.username,
      platform: 'telegram',
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

  ws.on('close', (code) => {
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
      logger.info(JSON.stringify(msg, null, 4));
      if (msg.type === 'message') {
        bot.sendMessage(msg.message);
      }
    } catch (error) {
      catchException(error);
    }
  });
});
