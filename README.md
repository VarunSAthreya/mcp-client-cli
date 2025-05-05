# MCP Client CLI

This is an MCP client which can be used to interact with the MCP server. It is a command line interface (CLI) that allows users to perform various operations on the MCP server.

## Setup
1. Clone the repository:
   ```bash
   git clone https://github.com/VarunSAthreya/mcp-client-cli.git
   cd mcp-client-cli
   ```

2. Install Dependency:
    ```bash
    npm install
    ```

3. Add environment variables:
    NOTE: Example MCP server, and currently it only support local mcp servers.
    ```env
    OPENAI_API_KEY="sk-..."
    SERVER_CONFIG = '{
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"]
    }'
    ```

1. Run the cli
    ```bash
    npm start
    ```
