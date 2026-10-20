// Peer-to-peer networking with PeerJS (WebRTC data channels).
// The room creator claims the peer id PEER_PREFIX + code and runs the Room; everyone else connects to them.
// PeerJS's free public server is only used to introduce peers; game traffic goes browser to browser.

import { Peer } from 'peerjs';
import { PEER_PREFIX, TICK_RATE } from './config.js';
import { Room } from './room.js';
import { workerInterval } from './timer.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const CONNECT_TIMEOUT = 15000;

function randomCode() {
  let code = '';
  for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

function openPeer(id) {
  return new Promise((resolve, reject) => {
    const peer = id ? new Peer(id, { debug: 1 }) : new Peer({ debug: 1 });
    const onError = (err) => {
      peer.destroy();
      reject(err);
    };
    peer.once('error', onError);
    peer.once('open', () => {
      peer.off('error', onError);
      resolve(peer);
    });
  });
}

export class Network {
  constructor(handlers) {
    this.handlers = handlers;
    this.peer = null;
    this.isHost = false;
    this.room = null;
    this.local = null;
    this.conn = null;
    this.lastHeard = 0;
  }

  dispatch(msg) {
    if (!msg || typeof msg.t !== 'string') return;
    this.lastHeard = performance.now();
    this.handlers[msg.t]?.(msg);
  }

  async host(joinMsg, trackId) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomCode();
      try {
        this.peer = await openPeer(PEER_PREFIX + code);
      } catch (err) {
        if (err.type === 'unavailable-id') continue; // someone already has this room code
        throw friendly(err);
      }
      this.isHost = true;
      this.room = new Room(code, trackId);
      this.peer.on('connection', (conn) => this.accept(conn));
      // Losing the signalling server doesn't break existing connections, but new players need it.
      this.peer.on('disconnected', () => { if (!this.peer.destroyed) this.peer.reconnect(); });
      this.local = this.room.add((msg) => queueMicrotask(() => this.dispatch(msg)), joinMsg, { local: true });
      // Ticks from a worker so the room keeps running while the host's tab is in the background.
      this.stopTicker = workerInterval(1000 / TICK_RATE, () => this.room.tick(Date.now()));
      return code;
    }
    throw new Error('Could not claim a room code. Try again?');
  }

  accept(conn) {
    let player = null;
    conn.on('data', (msg) => {
      if (!msg || typeof msg.t !== 'string') return;
      if (!player) {
        if (msg.t !== 'join') return;
        player = this.room.add((m) => { if (conn.open) conn.send(m); }, msg);
        if (!player) setTimeout(() => conn.close(), 500); // let the "room full" error arrive first
        else player.onKick = () => conn.close();
        return;
      }
      this.room.handle(player, msg);
    });
    conn.on('close', () => { if (player) this.room.remove(player.id); });
    conn.on('error', () => { if (player) this.room.remove(player.id); });
  }

  async join(code, joinMsg) {
    this.peer = await openPeer().catch((err) => { throw friendly(err); });
    const conn = this.peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json' });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Room ${code} didn't answer. Is the host still online?`)), CONNECT_TIMEOUT);
      conn.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      this.peer.once('error', (err) => {
        clearTimeout(timer);
        reject(err.type === 'peer-unavailable' ? new Error(`Room ${code} doesn't exist. Typo, or did the host leave?`) : friendly(err));
      });
    });
    this.conn = conn;
    conn.on('data', (msg) => this.dispatch(msg));
    conn.on('close', () => this.handlers.close?.());
    conn.send(joinMsg);
    this.lastHeard = performance.now();
    // Keep the host from kicking us while our tab is in the background (rAF stops there).
    this.keepAlive = setInterval(() => this.send({ t: 'ping' }), 2000);
  }

  send(msg) {
    if (this.isHost) {
      if (this.local) this.room.handle(this.local, msg);
    } else if (this.conn?.open) {
      this.conn.send(msg);
    }
  }

  // Clients: true if the host has gone quiet (WebRTC can take ages to notice a dead peer).
  hostSilent(now) {
    return !this.isHost && this.conn && now - this.lastHeard > 15000;
  }
}

function friendly(err) {
  const messages = {
    'browser-incompatible': 'Your browser does not support WebRTC. Try a recent Chrome, Firefox or Safari.',
    network: "Can't reach the matchmaking server. Check your internet connection.",
    'server-error': 'The matchmaking server had a hiccup. Try again in a moment.',
    'socket-error': "Can't reach the matchmaking server. Check your internet connection.",
    'ssl-unavailable': 'Secure connection to the matchmaking server failed.',
  };
  return new Error(messages[err?.type] ?? err?.message ?? String(err));
}
