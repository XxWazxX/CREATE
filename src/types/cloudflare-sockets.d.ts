// Cloudflare Workers built-in TCP sockets (only available at runtime on workerd).
declare module "cloudflare:sockets" {
  export type SocketOptions = { secureTransport?: "off" | "on" | "starttls"; allowHalfOpen?: boolean };
  export type Socket = {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
    closed: Promise<void>;
    close(): Promise<void>;
    startTls(): Socket;
  };
  export function connect(address: { hostname: string; port: number } | string, options?: SocketOptions): Socket;
}
