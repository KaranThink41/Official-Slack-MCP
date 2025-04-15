#!/usr/bin/env node
// ----------------------
// Weather MCP Server Example
// ----------------------
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
// import fetch from "node-fetch";
import { z } from "zod";
// Tool definition
const getWeatherTool = {
    name: "get_weather",
    description: "Get current weather for a city using the Open-Meteo API",
    inputSchema: {
        type: "object",
        properties: {
            city: {
                type: "string",
                description: "City name (e.g., 'London')",
            },
        },
        required: ["city"],
    },
};
// Helper: Get latitude/longitude for a city (using Open-Meteo geocoding)
async function getCoordinates(city) {
    const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`);
    const data = (await response.json());
    if (data.results && data.results.length > 0) {
        return { lat: data.results[0].latitude, lon: data.results[0].longitude };
    }
    return null;
}
async function getWeather(lat, lon) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`;
    const response = await fetch(url);
    return (await response.json());
}
// ----------------------
// Prompts Support (MCP Compliance)
// ----------------------
// Minimal prompt definition and handlers for MCP compliance
const weatherPrompt = {
    name: "weather_info",
    description: "Prompt for requesting weather information for a city.",
    arguments: {
        city: {
            type: "string",
            description: "City name (e.g., 'London')",
        },
    },
};
// Use Zod schemas for prompt handlers
const ListPromptsRequestSchema = z.object({ method: z.literal("prompts/list") });
const GetPromptRequestSchema = z.object({
    method: z.literal("prompts/get"),
    params: z.object({
        name: z.string(),
        arguments: z.object({ city: z.string() }),
    }),
});
// ----------------------
// Resource Support (Stub)
// ----------------------
// Use Zod schemas for resource handlers
const ListResourcesRequestSchema = z.object({ method: z.literal("resources/list") });
const ReadResourceRequestSchema = z.object({
    method: z.literal("resources/read"),
    params: z.object({ uri: z.string() }),
});
// ----------------------
// Main server setup
// ----------------------
async function main() {
    const server = new Server({
        name: "weather-mcp-server",
        version: "1.0.0",
    }, {
        capabilities: { tools: {}, prompts: {}, resources: {} },
    });
    // Tool handlers
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        if (request.params.name === "get_weather") {
            // Defensive: ensure arguments are of correct type
            const args = request.params.arguments;
            if (!args.city) {
                throw new Error("Missing required argument: city");
            }
            const coords = await getCoordinates(args.city);
            if (!coords) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Could not find coordinates for city: ${args.city}`,
                        },
                    ],
                };
            }
            const weather = await getWeather(coords.lat, coords.lon);
            return {
                content: [
                    {
                        type: "text",
                        text: `Current weather in ${args.city}: ${JSON.stringify(weather.current_weather)}`,
                    },
                ],
            };
        }
        throw new Error(`Unknown tool: ${request.params.name}`);
    });
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        return {
            tools: [getWeatherTool],
        };
    });
    // Prompts handlers
    server.setRequestHandler(ListPromptsRequestSchema, async () => {
        return { prompts: [weatherPrompt] };
    });
    server.setRequestHandler(GetPromptRequestSchema, async (request) => {
        if (request.params.name === "weather_info") {
            return {
                description: weatherPrompt.description,
                messages: [
                    { role: "user", content: `What is the weather in ${request.params.arguments.city}?` },
                ],
            };
        }
        throw new Error(`Unknown prompt: ${request.params.name}`);
    });
    // Resource handlers (stubbed)
    server.setRequestHandler(ListResourcesRequestSchema, async () => {
        return { resources: [] };
    });
    server.setRequestHandler(ReadResourceRequestSchema, async (_request) => {
        throw new Error("No resources available");
    });
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Weather MCP Server running on stdio");
}
main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
