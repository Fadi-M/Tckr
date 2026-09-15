/**
 * Test double for the browser WebSocket surface `TckrGatewaySource` (task 08) depends
 * on: `readyState`, `send`, `close`, and the `onopen`/`onmessage`/`onerror`/`onclose`
 * callback properties. It never opens a real socket — every conformance test installs
 * one of these via `TckrGatewaySourceDeps.createSocket` instead of letting the source
 * fall back to the global `WebSocket` constructor.
 *
 * Test-only surface, beyond the WebSocket shape itself:
 * - `sent`: every frame the source has written, in order, exactly as it went over the
 *   wire (post-`serializeClientMessage`) — assert byte-shape against it directly.
 * - `open()`: completes the handshake, firing `onopen`.
 * - `emit(message)`: delivers one server→client frame (an object is JSON-stringified
 *   first; a string is delivered verbatim, so a test can also feed deliberately
 *   malformed JSON for the forward-compatibility suite).
 * - `serverClose(code, reason)`: simulates the server ending the connection — this is
 *   how every close-code and reconnect test drives a "drop".
 * - `FakeWebSocket.lastInstance`: the most recently constructed instance, so a test
 *   whose `createSocket` is `(url) => new FakeWebSocket(url)` can reach the socket a
 *   reconnect just opened without threading a reference through the source.
 */

export type FakeWebSocketEvent = { readonly data: string };
export type FakeWebSocketCloseEvent = { readonly code: number; readonly reason: string };

export class FakeWebSocket {
  static lastInstance: FakeWebSocket | null = null;

  // Mirrors WebSocket.CONNECTING/OPEN/CLOSING/CLOSED numerically, without depending on
  // the DOM lib's WebSocket value (which does not exist in every test environment).
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly url: string;
  readonly sent: string[] = [];
  readyState: number = FakeWebSocket.CONNECTING;

  onopen: (() => void) | null = null;
  onmessage: ((event: FakeWebSocketEvent) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: FakeWebSocketCloseEvent) => void) | null = null;

  #closed = false;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.lastInstance = this;
  }

  send(data: string): void {
    if (this.readyState !== FakeWebSocket.OPEN) {
      throw new Error(`FakeWebSocket: send() called while not open (readyState=${this.readyState})`);
    }
    this.sent.push(data);
  }

  close(code = 1000, reason = ''): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }

  /** Test control: completes the handshake, firing `onopen`. A no-op once already past
   * the CONNECTING state (mirrors the real socket: you cannot re-open it). */
  open(): void {
    if (this.readyState !== FakeWebSocket.CONNECTING) {
      return;
    }
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  /** Test control: delivers one server→client frame. Accepts a plain object (JSON
   * fixture) or a raw string, so both well-formed and deliberately malformed frames
   * can be pushed through the exact same path a real socket would use. */
  emit(message: object | string): void {
    const data = typeof message === 'string' ? message : JSON.stringify(message);
    this.onmessage?.({ data });
  }

  /** Test control: simulates the server ending the connection with the given close
   * code — every abnormal-close and reconnect test drives a drop through this. */
  serverClose(code: number, reason = ''): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }
}
