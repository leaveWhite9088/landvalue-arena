import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { TOOLS } from "../shared/types.ts";

const ENDPOINT = "http://127.0.0.1:26101/internal/tool";

function desc(name: string): string {
  return TOOLS.find(t => t.name === name)?.description ?? "";
}

async function call(name: string, args: unknown) {
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, args }),
    });
    if (!res.ok) throw new Error(String(res.status));
    return await res.json();
  } catch {
    return {
      ok: false,
      error: {
        code: "server_unavailable",
        message: "沙盘服务未启动。先在项目目录运行 npm run dev。",
      },
    };
  }
}

function pack(data: { ok?: boolean }) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    isError: data?.ok === false,
  };
}

const server = new McpServer({ name: "landvalue", version: "1.0.0" });

server.registerTool("get_street_dictionary", { description: desc("get_street_dictionary") }, async () => {
  return pack(await call("get_street_dictionary", {}));
});

server.registerTool("list_buildings", { description: desc("list_buildings") }, async () => {
  return pack(await call("list_buildings", {}));
});

server.registerTool("get_map", { description: desc("get_map") }, async () => {
  return pack(await call("get_map", {}));
});

server.registerTool("place_building", {
  description: desc("place_building"),
  inputSchema: {
    buildingTypeId: z.string().describe("建筑类型标识，来自 list_buildings"),
    row: z.number().int().describe("锚点行，从 1 计"),
    col: z.number().int().describe("锚点列，从 1 计"),
    rotated: z.boolean().optional().describe("旋转 90°：仅两格建筑有效，true 时宽高互换"),
    reason: z.string().describe("放置理由，必填，不参与计算"),
  },
}, async (args) => pack(await call("place_building", args)));

server.registerTool("demolish_building", {
  description: desc("demolish_building"),
  inputSchema: {
    row: z.number().int().describe("任一占地格的行，从 1 计"),
    col: z.number().int().describe("任一占地格的列，从 1 计"),
    reason: z.string().describe("拆除理由，必填，不参与计算"),
  },
}, async (args) => pack(await call("demolish_building", args)));

const transport = new StdioServerTransport();
await server.connect(transport);
