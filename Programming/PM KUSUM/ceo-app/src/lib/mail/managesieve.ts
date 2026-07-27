import net from "net";
import tls from "tls";
import { getMailConfig } from "@/lib/mail/ceo-config";

/**
 * Minimal RFC 5804 ManageSieve client — no maintained npm package exists for
 * this protocol, so this implements only what the vacation-responder feature
 * needs: STARTTLS, PLAIN auth, PUTSCRIPT/GETSCRIPT/SETACTIVE/DELETESCRIPT/
 * LISTSCRIPTS. Verified against the real Dovecot Pigeonhole server this app
 * talks to (see docs/mail-feature-parity-plan.md Phase 6 notes).
 */

type SieveResponse = { ok: boolean; message: string; raw: string };

function readResponse(socket: net.Socket | tls.TLSSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const onData = (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      const lines = buf.split("\r\n");
      const last = lines[lines.length - 1] === "" ? lines[lines.length - 2] : lines[lines.length - 1];
      if (last !== undefined && /^(OK|NO|BYE)/.test(last)) {
        cleanup();
        resolve(buf);
      }
    };
    const onError = (e: Error) => {
      cleanup();
      reject(e);
    };
    function cleanup() {
      socket.removeListener("data", onData);
      socket.removeListener("error", onError);
    }
    socket.on("data", onData);
    socket.once("error", onError);
  });
}

function parseFinalStatus(raw: string): SieveResponse {
  const lines = raw.split("\r\n").filter(Boolean);
  const last = lines[lines.length - 1] || "";
  const ok = /^OK/.test(last);
  const messageMatch = last.match(/"([^"]*)"/);
  return { ok, message: messageMatch?.[1] || last, raw };
}

export class ManageSieveError extends Error {}

export class ManageSieveClient {
  private socket: net.Socket | tls.TLSSocket | null = null;
  private host: string;
  private port: number;

  constructor(host: string, port: number) {
    this.host = host;
    this.port = port;
  }

  private async send(command: string): Promise<SieveResponse> {
    if (!this.socket) throw new ManageSieveError("Not connected");
    this.socket.write(command.endsWith("\r\n") ? command : `${command}\r\n`);
    const raw = await readResponse(this.socket);
    return parseFinalStatus(raw);
  }

  async connect(): Promise<void> {
    const plain = net.connect(this.port, this.host);
    await new Promise<void>((resolve, reject) => {
      plain.once("connect", () => resolve());
      plain.once("error", reject);
    });
    await readResponse(plain); // greeting + capabilities

    plain.write("STARTTLS\r\n");
    const starttlsResp = parseFinalStatus(await readResponse(plain));
    if (!starttlsResp.ok) {
      plain.destroy();
      throw new ManageSieveError(`STARTTLS failed: ${starttlsResp.message}`);
    }

    const secure = tls.connect({ socket: plain, host: this.host, servername: this.host });
    await new Promise<void>((resolve, reject) => {
      secure.once("secureConnect", () => resolve());
      secure.once("error", reject);
    });
    await readResponse(secure); // post-TLS capabilities
    this.socket = secure;
  }

  async authenticate(user: string, pass: string): Promise<void> {
    const initialResponse = Buffer.from(`\0${user}\0${pass}`).toString("base64");
    const resp = await this.send(`AUTHENTICATE "PLAIN" "${initialResponse}"`);
    if (!resp.ok) throw new ManageSieveError(`Authentication failed: ${resp.message}`);
  }

  async listScripts(): Promise<{ name: string; active: boolean }[]> {
    if (!this.socket) throw new ManageSieveError("Not connected");
    this.socket.write("LISTSCRIPTS\r\n");
    const raw = await readResponse(this.socket);
    const status = parseFinalStatus(raw);
    if (!status.ok) throw new ManageSieveError(`LISTSCRIPTS failed: ${status.message}`);
    const scripts: { name: string; active: boolean }[] = [];
    for (const line of raw.split("\r\n")) {
      const m = line.match(/^"((?:[^"\\]|\\.)*)"(\s+ACTIVE)?$/i);
      if (m) scripts.push({ name: m[1]!.replace(/\\"/g, '"'), active: Boolean(m[2]) });
    }
    return scripts;
  }

  /** Upload (create or overwrite) a script — does NOT activate it. */
  async putScript(name: string, content: string): Promise<void> {
    if (!this.socket) throw new ManageSieveError("Not connected");
    const bytes = Buffer.byteLength(content, "utf8");
    this.socket.write(`PUTSCRIPT "${name}" {${bytes}+}\r\n${content}\r\n`);
    const raw = await readResponse(this.socket);
    const status = parseFinalStatus(raw);
    if (!status.ok) throw new ManageSieveError(`PUTSCRIPT failed: ${status.message}`);
  }

  async setActive(name: string): Promise<void> {
    const resp = await this.send(`SETACTIVE "${name}"`);
    if (!resp.ok) throw new ManageSieveError(`SETACTIVE failed: ${resp.message}`);
  }

  /** Deactivate whatever script is currently active (name = ""), without deleting it. */
  async deactivateAll(): Promise<void> {
    const resp = await this.send(`SETACTIVE ""`);
    if (!resp.ok) throw new ManageSieveError(`Deactivate failed: ${resp.message}`);
  }

  async deleteScript(name: string): Promise<void> {
    const resp = await this.send(`DELETESCRIPT "${name}"`);
    if (!resp.ok) throw new ManageSieveError(`DELETESCRIPT failed: ${resp.message}`);
  }

  async logout(): Promise<void> {
    if (!this.socket) return;
    try {
      this.socket.write("LOGOUT\r\n");
    } catch {
      /* already closing */
    }
    this.socket.destroy();
    this.socket = null;
  }
}

export async function withManageSieve<T>(
  account: { id: string; credentialKey: string; address: string; displayName?: string | null },
  fn: (client: ManageSieveClient) => Promise<T>,
): Promise<T> {
  const cfg = await getMailConfig(account);
  if (!cfg) throw new ManageSieveError("Mail account not configured");
  const client = new ManageSieveClient(cfg.host, cfg.sievePort);
  await client.connect();
  try {
    await client.authenticate(cfg.user, cfg.pass);
    return await fn(client);
  } finally {
    await client.logout();
  }
}
