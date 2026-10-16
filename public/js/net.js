// Thin WebSocket wrapper: dispatches JSON messages by their `t` field.
export class Net {
  constructor(handlers) {
    this.handlers = handlers;
    this.ws = null;
  }

  connect(onOpen) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws.addEventListener('open', onOpen);
    this.ws.addEventListener('message', (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      this.handlers[msg.t]?.(msg);
    });
    this.ws.addEventListener('close', (e) => this.handlers.close?.(e));
  }

  send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}
