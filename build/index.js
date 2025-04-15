#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpError, ErrorCode, CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import * as dotenv from "dotenv";
dotenv.config();
// Helper to resolve channel_name to channel_id
async function resolveChannelId(slackClient, channel_id, channel_name) {
    if (channel_id)
        return channel_id;
    if (!channel_name)
        throw new Error('Missing channel_id or channel_name');
    const channelsResp = await slackClient.getChannels(200);
    if (!channelsResp.ok)
        throw new Error('Failed to fetch channels list');
    const match = channelsResp.channels.find((ch) => ch.name === channel_name || ch.name_normalized === channel_name);
    if (!match)
        throw new Error(`Channel with name '${channel_name}' not found`);
    return match.id;
}
// Fetch last N messages from a channel
async function getChannelMessages(slackClient, args) {
    const channelId = await resolveChannelId(slackClient, args.channel_id, args.channel_name);
    const params = new URLSearchParams({
        channel: channelId,
        limit: (args.limit || 5).toString(),
    });
    const response = await fetch(`https://slack.com/api/conversations.history?${params}`, {
        headers: slackClient.botHeaders,
    });
    return response.json();
}
// Fetch recent messages where the bot/user is mentioned
async function getMentions(slackClient, args, userId) {
    const channelId = args.channel_id || (args.channel_name ? await resolveChannelId(slackClient, undefined, args.channel_name) : undefined);
    let messages = [];
    if (channelId) {
        const params = new URLSearchParams({
            channel: channelId,
            limit: (args.limit || 10).toString(),
        });
        const resp = await fetch(`https://slack.com/api/conversations.history?${params}`, { headers: slackClient.botHeaders });
        const data = await resp.json();
        if (data.ok)
            messages = data.messages;
    }
    else {
        // If no channel specified, search all channels (public only)
        const channelsResp = await slackClient.getChannels(200);
        if (!channelsResp.ok)
            throw new Error('Failed to fetch channels list');
        for (const ch of channelsResp.channels) {
            const params = new URLSearchParams({ channel: ch.id, limit: (args.limit || 10).toString() });
            const resp = await fetch(`https://slack.com/api/conversations.history?${params}`, { headers: slackClient.botHeaders });
            const data = await resp.json();
            if (data.ok)
                messages.push(...data.messages);
        }
    }
    // Filter messages where user is mentioned
    const mentionTag = `<@${userId}>`;
    const mentioned = messages.filter(msg => msg.text && msg.text.includes(mentionTag));
    return { ok: true, messages: mentioned.slice(0, args.limit || 10) };
}
// Tool definitions
const getChannelMessagesTool = {
    name: "get_channel_messages_on_slack",
    description: "Fetch the last N messages from a Slack channel (by channel_id or channel_name).",
    inputSchema: {
        type: "object",
        properties: {
            channel_id: {
                type: "string",
                description: "The ID of the channel to fetch messages from.",
            },
            channel_name: {
                type: "string",
                description: "The name of the channel to fetch messages from.",
            },
            limit: {
                type: "number",
                description: "Number of messages to fetch (default 5)",
                default: 5,
            },
        },
        required: [],
        anyOf: [
            { required: ["channel_id"] },
            { required: ["channel_name"] }
        ],
    },
};
const getMentionsTool = {
    name: "get_mentions_on_slack",
    description: "Fetch recent messages where the bot/user is mentioned (optionally by channel).",
    inputSchema: {
        type: "object",
        properties: {
            channel_id: {
                type: "string",
                description: "The ID of the channel to search mentions in (optional).",
            },
            channel_name: {
                type: "string",
                description: "The name of the channel to search mentions in (optional).",
            },
            limit: {
                type: "number",
                description: "Number of mention messages to fetch (default 10)",
                default: 10,
            },
        },
        required: [],
    },
};
const listChannelsTool = {
    name: "channels_list_on_slack",
    description: "List public channels in the workspace with pagination",
    inputSchema: {
        type: "object",
        properties: {
            limit: {
                type: "number",
                description: "Maximum number of channels to return (default 100, max 200)",
                default: 100,
            },
            cursor: {
                type: "string",
                description: "Pagination cursor for next page of results",
            },
        },
    },
};
const postMessageTool = {
    name: "send_message_on_slack",
    description: "Post a new message to a Slack channel. Provide either channel_id or channel_name.",
    inputSchema: {
        type: "object",
        properties: {
            channel_id: {
                type: "string",
                description: "The ID of the channel to post to.",
            },
            channel_name: {
                type: "string",
                description: "The name of the channel to post to (will be resolved to channel_id if channel_id is not provided).",
            },
            text: {
                type: "string",
                description: "The message text to post",
            },
        },
        required: ["text"],
        anyOf: [
            { required: ["channel_id"] },
            { required: ["channel_name"] }
        ],
    },
};
const replyToThreadTool = {
    name: "reply_to_thread_on_slack",
    description: "Reply to a specific message thread in Slack. Provide either channel_id or channel_name.",
    inputSchema: {
        type: "object",
        properties: {
            channel_id: {
                type: "string",
                description: "The ID of the channel containing the thread.",
            },
            channel_name: {
                type: "string",
                description: "The name of the channel containing the thread (will be resolved to channel_id if channel_id is not provided).",
            },
            thread_ts: {
                type: "string",
                description: "The timestamp of the parent message in the format '1234567890.123456'. Timestamps in the format without the period can be converted by adding the period such that 6 numbers come after it.",
            },
            text: {
                type: "string",
                description: "The reply text",
            },
        },
        required: ["thread_ts", "text"],
        anyOf: [
            { required: ["channel_id"] },
            { required: ["channel_name"] }
        ],
    },
};
const getChannelHistoryTool = {
    name: "get_channel_history_on_slack",
    description: "Get recent messages from a channel. Provide either channel_id or channel_name.",
    inputSchema: {
        type: "object",
        properties: {
            channel_id: {
                type: "string",
                description: "The ID of the channel.",
            },
            channel_name: {
                type: "string",
                description: "The name of the channel (will be resolved to channel_id if channel_id is not provided).",
            },
            limit: {
                type: "number",
                description: "Number of messages to retrieve (default 10)",
                default: 10,
            },
        },
        required: ["limit"],
        anyOf: [
            { required: ["channel_id"] },
            { required: ["channel_name"] }
        ],
    },
};
const getThreadRepliesTool = {
    name: "get_thread_replies_on_slack",
    description: "Get all replies in a message thread. Provide either channel_id or channel_name.",
    inputSchema: {
        type: "object",
        properties: {
            channel_id: {
                type: "string",
                description: "The ID of the channel containing the thread.",
            },
            channel_name: {
                type: "string",
                description: "The name of the channel containing the thread (will be resolved to channel_id if channel_id is not provided).",
            },
            thread_ts: {
                type: "string",
                description: "The timestamp of the parent message in the format '1234567890.123456'. Timestamps in the format without the period can be converted by adding the period such that 6 numbers come after it.",
            },
        },
        required: ["thread_ts"],
        anyOf: [
            { required: ["channel_id"] },
            { required: ["channel_name"] }
        ],
    },
};
const getUsersTool = {
    name: "get_users_on_slack",
    description: "Get a list of all users in the workspace with their basic profile information",
    inputSchema: {
        type: "object",
        properties: {
            cursor: {
                type: "string",
                description: "Pagination cursor for next page of results",
            },
            limit: {
                type: "number",
                description: "Maximum number of users to return (default 100, max 200)",
                default: 100,
            },
        },
    },
};
const getUserProfileTool = {
    name: "get_user_profile_on_slack",
    description: "Get detailed profile information for a specific user",
    inputSchema: {
        type: "object",
        properties: {
            user_id: {
                type: "string",
                description: "The ID of the user",
            },
        },
        required: ["user_id"],
    },
};
class SlackMcpServer {
    constructor() {
        this.slackClient = null;
        this.slackBotUserId = null; // To store the bot's user ID
        // Initialize the MCP server with metadata and capabilities.
        this.server = new Server({
            name: "slack-mcp-server",
            version: "0.1.0",
            description: "A Slack integration server that allows interaction with Slack workspace.\n" +
                "Tools include:\n" +
                "  • channels_list_on_slack: List public channels.\n" +
                "  • send_message_on_slack: Post a new message to a channel.\n" +
                "  • reply_to_thread_on_slack: Reply to a message thread.\n" +
                "  • get_channel_history_on_slack: Get recent messages from a channel.\n" +
                "  • get_thread_replies_on_slack: Get replies in a thread.\n" +
                "  • get_users_on_slack: List users in the workspace.\n" +
                "  • get_user_profile_on_slack: Get user profile information.\n" +
                "  • get_channel_messages_on_slack: Fetch last N messages from a channel.\n" +
                "  • get_mentions_on_slack: Fetch recent messages where the bot/user is mentioned.",
        }, {
            capabilities: { tools: {} },
        });
        this.setupToolHandlers();
        // Global error handling.
        this.server.onerror = (error) => console.error("[MCP Error]", error);
        process.on("SIGINT", async () => {
            await this.server.close();
            process.exit(0);
        });
    }
    async initializeSlackClient() {
        const botToken = process.env.SLACK_BOT_TOKEN;
        if (!botToken) {
            console.error("SLACK_BOT_TOKEN environment variable not set.");
            return null;
        }
        const slackClient = {
            botHeaders: {
                Authorization: `Bearer ${botToken}`,
                "Content-Type": "application/json",
            },
            getChannels: async (limit = 100, cursor) => {
                const params = new URLSearchParams({
                    types: "public_channel",
                    exclude_archived: "true",
                    limit: Math.min(limit, 200).toString(),
                    team_id: process.env.SLACK_TEAM_ID,
                });
                if (cursor)
                    params.append("cursor", cursor);
                const response = await fetch(`https://slack.com/api/conversations.list?${params}`, { headers: slackClient.botHeaders });
                return response.json();
            },
            postMessage: async (channel_id, text) => {
                const response = await fetch("https://slack.com/api/chat.postMessage", {
                    method: "POST",
                    headers: slackClient.botHeaders,
                    body: JSON.stringify({ channel: channel_id, text }),
                });
                return response.json();
            },
            postReply: async (channel_id, thread_ts, text) => {
                const response = await fetch("https://slack.com/api/chat.postMessage", {
                    method: "POST",
                    headers: slackClient.botHeaders,
                    body: JSON.stringify({ channel: channel_id, thread_ts, text }),
                });
                return response.json();
            },
            addReaction: async (channel_id, timestamp, reaction) => {
                const response = await fetch("https://slack.com/api/reactions.add", {
                    method: "POST",
                    headers: slackClient.botHeaders,
                    body: JSON.stringify({ channel: channel_id, timestamp, name: reaction }),
                });
                return response.json();
            },
            getChannelHistory: async (channel_id, limit = 10) => {
                const params = new URLSearchParams({ channel: channel_id, limit: limit.toString() });
                const response = await fetch(`https://slack.com/api/conversations.history?${params}`, { headers: slackClient.botHeaders });
                return response.json();
            },
            getThreadReplies: async (channel_id, thread_ts) => {
                const params = new URLSearchParams({ channel: channel_id, ts: thread_ts });
                const response = await fetch(`https://slack.com/api/conversations.replies?${params}`, { headers: slackClient.botHeaders });
                return response.json();
            },
            getUsers: async (limit = 100, cursor) => {
                const params = new URLSearchParams({
                    limit: Math.min(limit, 200).toString(),
                    team_id: process.env.SLACK_TEAM_ID,
                });
                if (cursor)
                    params.append("cursor", cursor);
                const response = await fetch(`https://slack.com/api/users.list?${params}`, { headers: slackClient.botHeaders });
                return response.json();
            },
            getUserProfile: async (user_id) => {
                const params = new URLSearchParams({ user: user_id, include_labels: "true" });
                const response = await fetch(`https://slack.com/api/users.profile.get?${params}`, { headers: slackClient.botHeaders });
                return response.json();
            },
        };
        return slackClient;
    }
    async fetchBotUserId() {
        if (!this.slackClient)
            return;
        try {
            const response = await fetch("https://slack.com/api/auth.test", {
                headers: this.slackClient.botHeaders,
            });
            const data = await response.json();
            if (data.ok && data.user_id) {
                this.slackBotUserId = data.user_id;
                console.error("Fetched Slack Bot User ID:", this.slackBotUserId);
            }
            else {
                console.error("Failed to fetch Slack Bot User ID:", data);
            }
        }
        catch (error) {
            console.error("Error during fetch of bot user ID:", error);
        }
    }
    setupToolHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [
                listChannelsTool,
                postMessageTool,
                replyToThreadTool,
                getChannelHistoryTool,
                getThreadRepliesTool,
                getUsersTool,
                getUserProfileTool,
                getChannelMessagesTool,
                getMentionsTool,
            ],
        }));
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const args = request.params.arguments;
            switch (request.params.name) {
                case "channels_list_on_slack":
                    return await this.handleListChannels(args);
                case "send_message_on_slack":
                    return await this.handlePostMessage(args);
                case "reply_to_thread_on_slack":
                    if (args && "thread_ts" in args && "text" in args) {
                        return await this.handleReplyToThread(args);
                    }
                    else {
                        throw new McpError(ErrorCode.InvalidRequest, "Missing required arguments: thread_ts and text for reply_to_thread_on_slack");
                    }
                case "get_channel_history_on_slack":
                    return await this.handleGetChannelHistory(args);
                case "get_thread_replies_on_slack":
                    if (args && "thread_ts" in args) {
                        return await this.handleGetThreadReplies(args);
                    }
                    else {
                        throw new McpError(ErrorCode.InvalidRequest, "Missing required argument: thread_ts for get_thread_replies_on_slack");
                    }
                case "get_users_on_slack":
                    return await this.handleGetUsers(args);
                case "get_user_profile_on_slack":
                    if (args && "user_id" in args) {
                        return await this.handleGetUserProfile(args);
                    }
                    else {
                        throw new McpError(ErrorCode.InvalidRequest, "Missing required argument: user_id for get_user_profile_on_slack");
                    }
                case "get_channel_messages_on_slack":
                    return await this.handleGetChannelMessages(args);
                case "get_mentions_on_slack":
                    return await this.handleGetMentions(args);
                default:
                    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
            }
        });
    }
    async handleListChannels(args) {
        if (!this.slackClient) {
            return { content: [{ type: "text", text: "Slack client not initialized." }], isError: true };
        }
        try {
            const response = await this.slackClient.getChannels(args.limit, args.cursor);
            return { content: [{ type: "text", text: JSON.stringify(response) }] };
        }
        catch (error) {
            console.error("Error listing channels:", error);
            return { content: [{ type: "text", text: `Error listing channels: ${error.message}` }], isError: true };
        }
    }
    async handlePostMessage(args) {
        if (!this.slackClient) {
            return { content: [{ type: "text", text: "Slack client not initialized." }], isError: true };
        }
        try {
            let channelId = args.channel_id;
            if (!channelId && args.channel_name) {
                channelId = await resolveChannelId(this.slackClient, undefined, args.channel_name);
            }
            if (!channelId) {
                return { content: [{ type: "text", text: "Missing channel_id or channel_name." }], isError: true };
            }
            const response = await this.slackClient.postMessage(channelId, args.text);
            return { content: [{ type: "text", text: JSON.stringify(response) }] };
        }
        catch (error) {
            console.error("Error sending message:", error);
            return { content: [{ type: "text", text: `Error sending message: ${error.message}` }], isError: true };
        }
    }
    async handleReplyToThread(args) {
        if (!this.slackClient) {
            return { content: [{ type: "text", text: "Slack client not initialized." }], isError: true };
        }
        try {
            let channelId = args.channel_id;
            if (!channelId && args.channel_name) {
                channelId = await resolveChannelId(this.slackClient, undefined, args.channel_name);
            }
            if (!channelId) {
                return { content: [{ type: "text", text: "Missing channel_id or channel_name." }], isError: true };
            }
            const response = await this.slackClient.postReply(channelId, args.thread_ts, args.text);
            return { content: [{ type: "text", text: JSON.stringify(response) }] };
        }
        catch (error) {
            console.error("Error replying to thread:", error);
            return { content: [{ type: "text", text: `Error replying to thread: ${error.message}` }], isError: true };
        }
    }
    async handleGetChannelHistory(args) {
        if (!this.slackClient) {
            return { content: [{ type: "text", text: "Slack client not initialized." }], isError: true };
        }
        try {
            let channelId = args.channel_id;
            if (!channelId && args.channel_name) {
                channelId = await resolveChannelId(this.slackClient, undefined, args.channel_name);
            }
            if (!channelId) {
                return { content: [{ type: "text", text: "Missing channel_id or channel_name." }], isError: true };
            }
            const response = await this.slackClient.getChannelHistory(channelId, args.limit);
            return { content: [{ type: "text", text: JSON.stringify(response) }] };
        }
        catch (error) {
            console.error("Error getting channel history:", error);
            return { content: [{ type: "text", text: `Error getting channel history: ${error.message}` }], isError: true };
        }
    }
    async handleGetThreadReplies(args) {
        if (!this.slackClient) {
            return { content: [{ type: "text", text: "Slack client not initialized." }], isError: true };
        }
        try {
            let channelId = args.channel_id;
            if (!channelId && args.channel_name) {
                channelId = await resolveChannelId(this.slackClient, undefined, args.channel_name);
            }
            if (!channelId) {
                return { content: [{ type: "text", text: "Missing channel_id or channel_name." }], isError: true };
            }
            const response = await this.slackClient.getThreadReplies(channelId, args.thread_ts);
            return { content: [{ type: "text", text: JSON.stringify(response) }] };
        }
        catch (error) {
            console.error("Error getting thread replies:", error);
            return { content: [{ type: "text", text: `Error getting thread replies: ${error.message}` }], isError: true };
        }
    }
    async handleGetUsers(args) {
        if (!this.slackClient) {
            return { content: [{ type: "text", text: "Slack client not initialized." }], isError: true };
        }
        try {
            const response = await this.slackClient.getUsers(args.limit, args.cursor);
            return { content: [{ type: "text", text: JSON.stringify(response) }] };
        }
        catch (error) {
            console.error("Error getting users:", error);
            return { content: [{ type: "text", text: `Error getting users: ${error.message}` }], isError: true };
        }
    }
    async handleGetUserProfile(args) {
        if (!this.slackClient) {
            return { content: [{ type: "text", text: "Slack client not initialized." }], isError: true };
        }
        try {
            const response = await this.slackClient.getUserProfile(args.user_id);
            return { content: [{ type: "text", text: JSON.stringify(response) }] };
        }
        catch (error) {
            console.error("Error getting user profile:", error);
            return { content: [{ type: "text", text: `Error getting user profile: ${error.message}` }], isError: true };
        }
    }
    async handleGetChannelMessages(args) {
        if (!this.slackClient) {
            return { content: [{ type: "text", text: "Slack client not initialized." }], isError: true };
        }
        try {
            const response = await getChannelMessages(this.slackClient, args);
            return { content: [{ type: "text", text: JSON.stringify(response) }] };
        }
        catch (error) {
            console.error("Error getting channel messages:", error);
            return { content: [{ type: "text", text: `Error getting channel messages: ${error.message}` }], isError: true };
        }
    }
    async handleGetMentions(args) {
        if (!this.slackClient) {
            return { content: [{ type: "text", text: "Slack client not initialized." }], isError: true };
        }
        if (!this.slackBotUserId) {
            await this.fetchBotUserId();
            if (!this.slackBotUserId) {
                return { content: [{ type: "text", text: "Slack Bot User ID not available." }], isError: true };
            }
        }
        try {
            const response = await getMentions(this.slackClient, args, this.slackBotUserId);
            return { content: [{ type: "text", text: JSON.stringify(response) }] };
        }
        catch (error) {
            console.error("Error getting mentions:", error);
            return { content: [{ type: "text", text: `Error getting mentions: ${error.message}` }], isError: true };
        }
    }
    /**
     * Start the MCP server using STDIO transport.
     */
    async run() {
        this.slackClient = await this.initializeSlackClient();
        if (!this.slackClient) {
            console.error("Failed to initialize Slack client. Check environment variables.");
            return;
        }
        await this.fetchBotUserId();
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error("Slack MCP server running on stdio");
    }
}
const server = new SlackMcpServer();
server.run().catch(console.error);
