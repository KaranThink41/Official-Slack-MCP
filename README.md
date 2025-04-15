# Slack MCP Server

A Model Context Protocol (MCP) server implementation for interacting with the Slack API. This server provides tools for Slack workspace automation.

## Features

- Post text messages to Slack channels
- Reply to threads
- Add reactions
- List channels and users
- Fetch channel history and thread replies

## Installation

### Local Development

1. Clone the repository and install dependencies:
```bash
npm install
```

2. Create a `.env` file with your Slack credentials:
```
SLACK_BOT_TOKEN=your_bot_token
SLACK_TEAM_ID=your_team_id
```

3. Build the project:
```bash
npm run build
```

4. Run the server:
```bash
node build/index.js
```

## Available Tools

### User Tools

#### get_users_on_slack
- **Description:** Get a list of all users in the workspace with their basic profile information.
- **Input:**
  ```json
  {
    "limit": 100,
    "cursor": "optional_cursor"
  }
  ```

#### get_user_profile_on_slack
- **Description:** Get detailed profile information for a specific user.
- **Input:**
  ```json
  {
    "user_id": "your_user_id"
  }
  ```

### Message Tools

#### send_message_on_slack
- **Description:** Post a new message to a Slack channel.
- **Input:**
  ```json
  {
    "channel_id": "your_channel_id",
    "text": "Hello, world!"
  }
  ```

### Thread Tools

#### reply_to_thread_on_slack
- **Description:** Reply to a specific message thread in Slack.
- **Input:**
  ```json
  {
    "channel_id": "your_channel_id",
    "thread_ts": "your_thread_ts",
    "text": "This is a reply"
  }
  ```

#### get_thread_replies_on_slack
- **Description:** Get all replies in a message thread.
- **Input:**
  ```json
  {
    "channel_id": "your_channel_id",
    "thread_ts": "your_thread_ts"
  }
  ```

### Channel Tools

#### channels_list_on_slack
- **Description:** List public channels in the workspace with pagination.
- **Input:**
  ```json
  {
    "limit": 100,
    "cursor": "optional_cursor"
  }
  ```

#### get_channel_history_on_slack
- **Description:** Get recent messages from a channel.
- **Input:**
  ```json
  {
    "channel_id": "your_channel_id",
    "limit": 10
  }
  ```

### Reaction Tools

#### slack_add_reaction
- **Description:** Add a reaction emoji to a message.
- **Input:**
  ```json
  {
    "channel_id": "your_channel_id",
    "timestamp": "your_message_ts",
    "reaction": "your_reaction"
  }
  ```

## Usage Example

To call a tool, send a JSON request like this:
```json
{
  "method": "tools/call",
  "params": {
    "name": "send_message_on_slack",
    "arguments": {
      "channel_id": "your_channel_id",
      "text": "Hello from the Slack MCP server!"
    }
  }
}
```

## Environment Variables

Create a `.env` file with:
```
SLACK_BOT_TOKEN=your_bot_token
SLACK_TEAM_ID=your_team_id
```

## Running the Server

```bash
npm install
npm run build
npx @modelcontextprotocol/slack-server
```

Or, for direct node execution:
```bash
node build/index.js
```

## License

MIT License. See [LICENSE](LICENSE) for details.
