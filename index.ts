import Polka from "polka"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js"
import { z } from "zod"
import { dump } from "js-yaml"
import { version } from "./package.json"

import Exa, { type RegularSearchOptions } from "exa-js"

const apiKey = process.env.EXA_API_KEY
if (!apiKey) {
  throw new Error("EXA_API_KEY env is not set")
}

const exa = new Exa(apiKey)

const server = new McpServer(
  {
    name: "exa-mcp",
    version,
  },
  {
    capabilities: {
      logging: {},
    },
  }
)

server.tool(
  "exa_search",
  "Search the web using Exa API",
  {
    query: z.string().describe("The search query"),
    category: z
      .enum([
        "general",
        "company",
        "research paper",
        "news",
        "pdf",
        "github",
        "tweet",
        "personal site",
        "linkedin profile",
        "financial report",
      ])
      .default("general")
      .describe("The result type"),
    num_results: z
      .number()
      .min(1)
      .max(100)
      .default(10)
      .describe("The number of results to return"),
    start_published_date: z
      .string()
      .date()
      .optional()
      .describe("The start date of the results"),
    end_published_date: z
      .string()
      .date()
      .optional()
      .describe("The end date of the results"),
    include_domains: z
      .array(z.string())
      .optional()
      .describe("The domains to include in the results"),
    exclude_domains: z
      .array(z.string())
      .optional()
      .describe("The domains to exclude in the results"),
    live_crawl: z
      .boolean()
      .default(false)
      .describe("Crawl results in real-time, instead of using cached results"),
    full_text: z
      .boolean()
      .default(false)
      .describe("Return full webpage text for every result"),
    ai_summary: z
      .boolean()
      .default(false)
      .describe("Return AI generated summary for every result"),
  },
  async (args) => {
    const regularSearchOptions: RegularSearchOptions = {
      category: args.category === "general" ? undefined : args.category,
      numResults: args.num_results,
      startPublishedDate: args.start_published_date
        ? new Date(args.start_published_date).toISOString()
        : undefined,
      endPublishedDate: args.end_published_date
        ? new Date(args.end_published_date).toISOString()
        : undefined,
      includeDomains: args.include_domains,
      excludeDomains: args.exclude_domains,
    }

    try {
      const result =
        args.full_text || args.ai_summary
          ? await exa.searchAndContents(args.query, {
              ...regularSearchOptions,
              text: args.full_text ? true : undefined,
              summary: args.ai_summary ? true : undefined,
            })
          : await exa.search(args.query, regularSearchOptions)

      return {
        content: [
          {
            type: "text",
            text: [
              `[search result start]`,
              dump(result.results),
              `[search result end]`,
            ].join("\n"),
          },
        ],
      }
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      }
    }
  }
)

if (process.argv.includes("--sse")) {
  const transports = new Map<string, SSEServerTransport>()
  const port = Number(process.env.PORT || "3000")

  const app = Polka()

  app.get("/sse", async (req, res) => {
    const transport = new SSEServerTransport("/messages", res)
    transports.set(transport.sessionId, transport)
    res.on("close", () => {
      transports.delete(transport.sessionId)
    })
    await server.connect(transport)
  })

  app.post("/messages", async (req, res) => {
    const sessionId = req.query.sessionId as string
    const transport = transports.get(sessionId)
    if (transport) {
      await transport.handlePostMessage(req, res)
    } else {
      res.status(400).send("No transport found for sessionId")
    }
  })

  app.listen(port)
  console.log(`sse server: http://localhost:${port}/sse`)
} else {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
