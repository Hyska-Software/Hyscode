import type {
  LspRequest,
  LspResponse,
  LspNotification,
  MessageTransport,
} from './types';

type TauriInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
type TauriListen = (event: string, handler: (payload: { payload: string }) => void) => Promise<() => void>;

export class TauriLspTransport implements MessageTransport {
  private messageHandler: ((msg: LspResponse | LspNotification) => void) | null = null;
  private unlisten: (() => void) | null = null;
  private invoke: TauriInvoke;
  private listen: TauriListen;
  private serverId: string;

  constructor(serverId: string, invoke: TauriInvoke, listen: TauriListen) {
    this.serverId = serverId;
    this.invoke = invoke;
    this.listen = listen;
  }

  async start(): Promise<void> {
    const unlisten = await this.listen(`lsp:message:${this.serverId}`, (event) => {
      try {
        const msg = JSON.parse(event.payload) as LspResponse | LspNotification;
        this.messageHandler?.(msg);
      } catch (err) {
        console.error(`[TauriLspTransport] Failed to parse LSP message:`, err);
      }
    });
    this.unlisten = unlisten;
  }

  async send(message: LspRequest | LspNotification): Promise<void> {
    const json = JSON.stringify(message);
    try {
      await this.invoke('lsp_send', { id: this.serverId, content: json });
    } catch (err) {
      // Log AND propagate: swallowing here would leave the caller hanging
      // until the 30s request timeout. LspConnection fails fast on rejection.
      console.error(`[TauriLspTransport] Failed to send message:`, err);
      throw err;
    }
  }

  onMessage(handler: (message: LspResponse | LspNotification) => void): void {
    this.messageHandler = handler;
  }

  close(): void {
    this.unlisten?.();
    this.unlisten = null;
    this.messageHandler = null;
  }
}
