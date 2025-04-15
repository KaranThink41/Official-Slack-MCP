#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequest,
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import * as dotenv from "dotenv";

dotenv.config();

// Helper to resolve channel_name to channel_id
async function resolveChannelId(slackClient: any, channel_id?: string, channel_name?: string): Promise<string> {
  if (channel_id) return channel_id;
  if (!channel_name) throw new Error('Missing channel_id or channel_name');
  const channelsResp = await slackClient.getChannels(200);
  if (!channelsResp.ok) throw new Error('Failed to fetch channels list');
  const match = channelsResp.channels.find((ch: any) => ch.name === channel_name || ch.name_normalized === channel_name);
  if (!match) throw new Error(`Channel with name '${channel_name}' not found`);
  return match.id;
}

// Fetch last N messages from a channel
async function getChannelMessages(slackClient: any, args: { channel_id?: string, channel_name?: string, limit?: number }) {
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
async function getMentions(slackClient: any, args: { channel_id?: string, channel_name?: string, limit?: number }, userId: string) {
  const channelId = args.channel_id || (args.channel_name ? await resolveChannelId(slackClient, undefined, args.channel_name) : undefined);
  let messages: any[] = [];
  if (channelId) {
    const params = new URLSearchParams({
      channel: channelId,
      limit: (args.limit || 10).toString(),
    });
    const resp = await fetch(`https://slack.com/api/conversations.history?${params}`, { headers: slackClient.botHeaders });
    const data = await resp.json();
    if (data.ok) messages = data.messages;
  } else {
    // If no channel specified, search all channels (public only)
    const channelsResp = await slackClient.getChannels(200);
    if (!channelsResp.ok) throw new Error('Failed to fetch channels list');
    for (const ch of channelsResp.channels) {
      const params = new URLSearchParams({ channel: ch.id, limit: (args.limit || 10).toString() });
      const resp = await fetch(`https://slack.com/api/conversations.history?${params}`, { headers: slackClient.botHeaders });
      const data = await resp.json();
      if (data.ok) messages.push(...data.messages);
    }
  }
  // Filter messages where user is mentioned
  const mentionTag = `<@${userId}>`;
  const mentioned = messages.filter(msg => msg.text && msg.text.includes(mentionTag));
  return { ok: true, messages: mentioned.slice(0, args.limit || 10) };
}


// Type definitions for tool arguments
interface ListChannelsArgs {
  limit?: number;
  cursor?: string;
}

interface PostMessageArgs {
  channel_id?: string;
  channel_name?: string;
  text: string;
}

interface ReplyToThreadArgs {
  channel_id?: string;
  channel_name?: string;
  thread_ts: string;
  text: string;
}

interface AddReactionArgs {
  channel_id?: string;
  channel_name?: string;
  timestamp: string;
  reaction: string;
}

interface GetChannelHistoryArgs {
  channel_id?: string;
  channel_name?: string;
  limit?: number;
}

interface GetThreadRepliesArgs {
  channel_id?: string;
  channel_name?: string;
  thread_ts: string;
}

interface GetUsersArgs {
  cursor?: string;
  limit?: number;
}

interface GetUserProfileArgs {
  user_id: string;
}

// Tool definitions
const getChannelMessagesTool: Tool = {
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

const getMentionsTool: Tool = {
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

const listChannelsTool: Tool = {
  name: "channels_list_on_slack",
  description: "List public channels in the workspace with pagination",
  inputSchema: {
    type: "object",
    properties: {
      limit: {
        type: "number",
        description:
          "Maximum number of channels to return (default 100, max 200)",
        default: 100,
      },
      cursor: {
        type: "string",
        description: "Pagination cursor for next page of results",
      },
    },
  },
};

const postMessageTool: Tool = {
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

const replyToThreadTool: Tool = {
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


const getChannelHistoryTool: Tool = {
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

const getThreadRepliesTool: Tool = {
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

const getUsersTool: Tool = {
  name: "get_users_on_slack",
  description:
    "Get a list of all users in the workspace with their basic profile information",
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

const getUserProfileTool: Tool = {
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

class SlackClient {
  private botHeaders: { Authorization: string; "Content-Type": string };

  constructor(botToken: string) {
    this.botHeaders = {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json",
    };
  }

  async getChannels(limit: number = 100, cursor?: string): Promise<any> {
    const params = new URLSearchParams({
      types: "public_channel",
      exclude_archived: "true",
      limit: Math.min(limit, 200).toString(),
      team_id: process.env.SLACK_TEAM_ID!,
    });

    if (cursor) {
      params.append("cursor", cursor);
    }

    const response = await fetch(
      `https://slack.com/api/conversations.list?${params}`,
      { headers: this.botHeaders },
    );

    return response.json();
  }

  async postMessage(channel_id: string, text: string): Promise<any> {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: this.botHeaders,
      body: JSON.stringify({
        channel: channel_id,
        text: text,
      }),
    });

    return response.json();
  }

  async postReply(
    channel_id: string,
    thread_ts: string,
    text: string,
  ): Promise<any> {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: this.botHeaders,
      body: JSON.stringify({
        channel: channel_id,
        thread_ts: thread_ts,
        text: text,
      }),
    });

    return response.json();
  }

  async addReaction(
    channel_id: string,
    timestamp: string,
    reaction: string,
  ): Promise<any> {
    const response = await fetch("https://slack.com/api/reactions.add", {
      method: "POST",
      headers: this.botHeaders,
      body: JSON.stringify({
        channel: channel_id,
        timestamp: timestamp,
        name: reaction,
      }),
    });

    return response.json();
  }

  async getChannelHistory(
    channel_id: string,
    limit: number = 10,
  ): Promise<any> {
    const params = new URLSearchParams({
      channel: channel_id,
      limit: limit.toString(),
    });

    const response = await fetch(
      `https://slack.com/api/conversations.history?${params}`,
      { headers: this.botHeaders },
    );

    return response.json();
  }

  async getThreadReplies(channel_id: string, thread_ts: string): Promise<any> {
    const params = new URLSearchParams({
      channel: channel_id,
      ts: thread_ts,
    });

    const response = await fetch(
      `https://slack.com/api/conversations.replies?${params}`,
      { headers: this.botHeaders },
    );

    return response.json();
  }

  async getUsers(limit: number = 100, cursor?: string): Promise<any> {
    const params = new URLSearchParams({
      limit: Math.min(limit, 200).toString(),
      team_id: process.env.SLACK_TEAM_ID!,
    });

    if (cursor) {
      params.append("cursor", cursor);
    }

    const response = await fetch(`https://slack.com/api/users.list?${params}`, {
      headers: this.botHeaders,
    });

    return response.json();
  }

  async getUserProfile(user_id: string): Promise<any> {
    const params = new URLSearchParams({
      user: user_id,
      include_labels: "true",
    });

    const response = await fetch(
      `https://slack.com/api/users.profile.get?${params}`,
      { headers: this.botHeaders },
    );

    return response.json();
  }
}

async function main() {
  const botToken = process.env.SLACK_BOT_TOKEN;
  const teamId = process.env.SLACK_TEAM_ID;

  if (!botToken || !teamId) {
    console.error(
      "Please set SLACK_BOT_TOKEN and SLACK_TEAM_ID environment variables",
    );
    process.exit(1);
  }

  console.error("Starting Slack MCP Server...");
  const server = new Server(
    {
      name: "Official Slack MCP",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  const slackClient = new SlackClient(botToken);

  server.setRequestHandler(
    CallToolRequestSchema,
    async (request: CallToolRequest) => {
      console.error("Received CallToolRequest:", request);
      try {
        if (!request.params.arguments) {
          throw new Error("No arguments provided");
        }

        switch (request.params.name) {
          case "channels_list_on_slack": {
            const args = request.params
              .arguments as unknown as ListChannelsArgs;
            const response = await slackClient.getChannels(
              args.limit,
              args.cursor,
            );
            return {
              content: [{ type: "text", text: JSON.stringify(response) }],
            };
          }

          case "send_message_on_slack": {
            const args = request.params.arguments as unknown as PostMessageArgs;
            let channelId = args.channel_id;
            if (!channelId && args.channel_name) {
              // Resolve channel_name to channel_id
              const channelsResp = await slackClient.getChannels(200);
              if (!channelsResp.ok) {
                throw new Error('Failed to fetch channels list');
              }
              const match = channelsResp.channels.find(
                (ch: any) => ch.name === args.channel_name || ch.name_normalized === args.channel_name
              );
              if (!match) {
                throw new Error(`Channel with name '${args.channel_name}' not found`);
              }
              channelId = match.id;
            }
            if (!channelId) {
              throw new Error("Missing required argument: channel_id or channel_name");
            }
            if (!args.text) {
              throw new Error("Missing required argument: text");
            }
            const response = await slackClient.postMessage(
              channelId,
              args.text,
            );
            return {
              content: [{ type: "text", text: JSON.stringify(response) }],
            };
          }

          case "reply_to_thread_on_slack": {
            const args = request.params
              .arguments as unknown as ReplyToThreadArgs;
            if (!args.channel_id || !args.thread_ts || !args.text) {
              throw new Error(
                "Missing required arguments: channel_id, thread_ts, and text",
              );
            }
            const response = await slackClient.postReply(
              args.channel_id,
              args.thread_ts,
              args.text,
            );
            return {
              content: [{ type: "text", text: JSON.stringify(response) }],
            };
          }

          

          case "get_channel_history_on_slack": {
            const args = request.params
              .arguments as unknown as GetChannelHistoryArgs;
            let channelId = args.channel_id;
            if (!channelId && args.channel_name) {
              const channelsResp = await slackClient.getChannels(200);
              if (!channelsResp.ok) {
                throw new Error('Failed to fetch channels list');
              }
              const match = channelsResp.channels.find(
                (ch: any) => ch.name === args.channel_name || ch.name_normalized === args.channel_name
              );
              if (!match) {
                throw new Error(`Channel with name '${args.channel_name}' not found`);
              }
              channelId = match.id;
            }
            if (!channelId) {
              throw new Error("Missing required argument: channel_id or channel_name");
            }
            const response = await slackClient.getChannelHistory(
              channelId,
              args.limit,
            );
            return {
              content: [{ type: "text", text: JSON.stringify(response) }],
            };
          }

          case "get_thread_replies_on_slack": {
            const args = request.params
              .arguments as unknown as GetThreadRepliesArgs;
            let channelId = args.channel_id;
            if (!channelId && args.channel_name) {
              const channelsResp = await slackClient.getChannels(200);
              if (!channelsResp.ok) {
                throw new Error('Failed to fetch channels list');
              }
              const match = channelsResp.channels.find(
                (ch: any) => ch.name === args.channel_name || ch.name_normalized === args.channel_name
              );
              if (!match) {
                throw new Error(`Channel with name '${args.channel_name}' not found`);
              }
              channelId = match.id;
            }
            if (!channelId) {
              throw new Error("Missing required argument: channel_id or channel_name");
            }
            if (!args.thread_ts) {
              throw new Error(
                "Missing required argument: thread_ts",
              );
            }
            const response = await slackClient.getThreadReplies(
              channelId,
              args.thread_ts,
            );
            return {
              content: [{ type: "text", text: JSON.stringify(response) }],
            };
          }

          case "get_users_on_slack": {
            const args = request.params.arguments as unknown as GetUsersArgs;
            const response = await slackClient.getUsers(
              args.limit,
              args.cursor,
            );
            return {
              content: [{ type: "text", text: JSON.stringify(response) }],
            };
          }

          case "get_user_profile_on_slack": {
            const args = request.params
              .arguments as unknown as GetUserProfileArgs;
            if (!args.user_id) {
              throw new Error("Missing required argument: user_id");
            }
            const response = await slackClient.getUserProfile(args.user_id);
            return {
              content: [{ type: "text", text: JSON.stringify(response) }],
            };
          }

          case "get_channel_messages_on_slack": {
            const args = request.params.arguments;
            const response = await getChannelMessages(slackClient, args);
            return {
              content: [{ type: "text", text: JSON.stringify(response) }],
            };
          }

          case "get_mentions_on_slack": {
            const args = request.params.arguments;
            // TODO: Replace with proper user ID retrieval/auth context
            // For now, use a placeholder or fetch from SlackClient if available
            const userId = "PLACEHOLDER_USER_ID";
            const response = await getMentions(slackClient, args, userId);
            return {
              content: [{ type: "text", text: JSON.stringify(response) }],
            };
          }

          default:
            throw new Error(`Unknown tool: ${request.params.name}`);
        }
      } catch (error) {
        console.error("Error executing tool:", error);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: error instanceof Error ? error.message : String(error),
              }),
            },
          ],
        };
      }
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    console.error("Received ListToolsRequest");
    return {
      tools: [
        listChannelsTool,
        postMessageTool,
        replyToThreadTool,
        getChannelHistoryTool,
        getThreadRepliesTool,
        getUsersTool,
        getUserProfileTool,
      ],
    };
  });

  const transport = new StdioServerTransport();
  console.error("Connecting server to transport...");
  await server.connect(transport);

  console.error("Slack MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});