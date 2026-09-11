/* ================================================================
   protocol — MCP over stdio, by hand.

   MCP is JSON-RPC 2.0 with a small handshake, framed as newline-
   delimited json on stdin/stdout. That is little enough that writing
   it directly costs less than a dependency, and this repo vendors
   what it needs rather than installing it.

   One rule worth stating loudly: stdout is the transport. Anything
   printed there that is not a json-rpc message corrupts the stream,
   so all logging goes to stderr.
   ================================================================ */

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

export const log = (...a) => process.stderr.write("[mcp] " + a.join(" ") + "\n");

export function createServer({ name, version, tools }) {
  const byName = new Map(tools.map((t) => [t.name, t]));

  const write = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
  const reply = (id, result) => write({ jsonrpc: "2.0", id, result });
  const fail = (id, code, message, data) =>
    write({ jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } });

  async function handle(msg) {
    const { id, method, params } = msg;
    // notifications carry no id and must never be answered
    const isNotification = id === undefined || id === null;

    switch (method) {
      case "initialize": {
        const asked = params?.protocolVersion;
        return reply(id, {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name, version },
        });
      }
      case "notifications/initialized":
      case "notifications/cancelled":
        return;   // nothing to acknowledge

      case "ping":
        return reply(id, {});

      case "tools/list":
        return reply(id, {
          tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
        });

      case "tools/call": {
        const tool = byName.get(params?.name);
        if (!tool) return fail(id, -32602, `unknown tool: ${params?.name}`);
        try {
          const out = await tool.run(params?.arguments ?? {});
          const text = typeof out === "string" ? out : JSON.stringify(out, null, 2);
          return reply(id, { content: [{ type: "text", text }] });
        } catch (err) {
          // a failing tool is a result, not a transport error: the model
          // should see what went wrong and be able to act on it
          return reply(id, {
            isError: true,
            content: [{ type: "text", text: `${tool.name} failed: ${err?.message ?? err}` }],
          });
        }
      }

      default:
        if (isNotification) return;
        return fail(id, -32601, `method not found: ${method}`);
    }
  }

  return {
    async listen(stream = process.stdin) {
      let buffer = "";
      stream.setEncoding("utf8");
      for await (const chunk of stream) {
        buffer += chunk;
        let nl;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          let msg;
          try { msg = JSON.parse(line); }
          catch { fail(null, -32700, "parse error"); continue; }
          try { await handle(msg); }
          catch (err) { log("handler crashed:", err?.stack ?? err); if (msg?.id != null) fail(msg.id, -32603, String(err?.message ?? err)); }
        }
      }
    },
  };
}
