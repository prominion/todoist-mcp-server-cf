# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Todoist MCP (Model Context Protocol) server** deployed on **Cloudflare Workers**. It provides 43 MCP tools (18 essential tools enabled by default) that allow AI assistants to interact with Todoist via OAuth 2.0, offering complete CRUD operations for projects, sections, tasks, labels, comments, and reminders.

**Key Technologies:**
- **Cloudflare Workers** for serverless deployment
- **MCP SDK** (`@modelcontextprotocol/sdk`) for Model Context Protocol
- **Streamable HTTP** transport (MCP protocol version 2025-03-26)
- **Durable Objects** for stateful MCP server instances
- **KV Storage** for encrypted OAuth token storage
- **Hono** framework for HTTP routing
- **Zod** for schema validation
- **TypeScript** for type safety

## Common Development Commands

### Setup
```bash
npm install
```

### Local Development
```bash
npm run dev          # Start local Wrangler dev server on port 8788
npm run start        # Alternative command for local dev
```

### Deployment

**중요: 배포는 반드시 아래 방법으로 진행해야 합니다.**

Cloudflare API 토큰은 `.claude/settings.local.json` 파일에 저장되어 있습니다. 배포 시 반드시 환경 변수를 설정하고 wrangler CLI로 실행합니다:

```bash
export CLOUDFLARE_API_TOKEN=<token-from-settings.local.json> && wrangler deploy
```

토큰 위치: `.claude/settings.local.json` 파일의 `permissions.allow` 배열에서 `Bash(export CLOUDFLARE_API_TOKEN=...)` 항목을 확인하세요.

**주의**: `npm run deploy`는 사용하지 마세요. 반드시 위의 환경 변수 설정 방식으로 배포해야 합니다.

### Code Quality
```bash
npm run lint         # Run ESLint on src/**/*.ts
npm run lint-fix     # Auto-fix ESLint issues
npm run fmt          # Format code with Prettier
npm run fix-all      # Format and auto-fix all issues (fmt + lint-fix)
```

### Cloudflare Configuration
```bash
npm run cf-typegen   # Generate TypeScript types from wrangler.jsonc
wrangler secret put TODOIST_CLIENT_ID        # Set Todoist OAuth client ID
wrangler secret put TODOIST_CLIENT_SECRET    # Set Todoist OAuth client secret
```

### Secrets Management
Before deployment, you must configure two secrets:
```bash
wrangler secret put TODOIST_CLIENT_ID
wrangler secret put TODOIST_CLIENT_SECRET
```

These are obtained from the [Todoist App Console](https://developer.todoist.com/appconsole.html).

## Architecture

### High-Level Flow

1. **OAuth Flow** (`todoist-auth-handler.ts`):
   - `/authorize` endpoint initiates OAuth with Todoist
   - `/callback` endpoint handles OAuth callback, exchanges code for access token
   - User metadata (email, full_name) and access token are stored as "props"

2. **MCP Server** (`index.ts` - `TodoistMCP` class):
   - Extends `McpAgent<Env, unknown, Props>` from `agents/mcp`
   - Uses **Durable Objects** for stateful server instances
   - Each authenticated user gets their own durable object instance
   - Props (user email, name, access token) are injected into the MCP server instance

3. **API Client** (`TodoistApiClient.ts`):
   - Wraps Todoist API v1 (`https://api.todoist.com/api/v1`)
   - Provides `get()`, `post()`, `delete()` methods for REST endpoints
   - Provides `sync()` method for Sync API endpoint (`application/x-www-form-urlencoded`)
   - Provides `getCurrentUser()` for OAuth flow
   - Handles authorization headers and error responses

4. **Entry Point** (`index.ts` exports):
   - Uses `@cloudflare/workers-oauth-provider` to orchestrate OAuth + MCP serving
   - Routes `/mcp` to MCP server using Streamable HTTP transport, OAuth routes to auth handler

### Tool Filtering System

The server implements **configurable tool filtering** to reduce context token usage (lines 21-35 in `index.ts`):

- **`MINIMAL_TOOL_SET = true`** (default): Exposes only 18 essential tools (~12-15k tokens)
- **`MINIMAL_TOOL_SET = false`**: Exposes all 43 tools (~27k tokens)
- **`ESSENTIAL_TOOLS`** Set defines which tools are included in minimal mode
- **`shouldRegisterTool(toolName)`** determines if a tool should be registered

**To add a new tool to the essential set:**
1. Add the tool name to the `ESSENTIAL_TOOLS` Set constant
2. The tool will automatically be included when `MINIMAL_TOOL_SET = true`

**To add a new non-essential tool:**
1. Wrap tool registration in `if (this.shouldRegisterTool('tool_name'))`
2. Tool will only be registered when `MINIMAL_TOOL_SET = false`

### Cloudflare Configuration

**`wrangler.jsonc.example`** must be copied to **`wrangler.jsonc`** and customized:
- **KV Namespace ID**: Replace `<YOUR_KV_NAMESPACE_ID>` with your actual KV namespace ID
- **Worker name**: Customize the `name` field if needed
- **Durable Objects**: The `TodoistMCP` class is registered as a Durable Object
- **Secrets**: `TODOIST_CLIENT_ID` and `TODOIST_CLIENT_SECRET` are set via `wrangler secret put`

### Important Implementation Details

1. **Tool Registration Pattern**: All MCP tools are registered in the `init()` method using `this.server.tool(name, description, schema, handler)`

2. **Error Handling**: Always catch errors and return `{ content: [...], isError: true }` format

3. **Access Token**: Available via `this.props.accessToken` in all tool handlers

4. **API Base URL**:
   - 통합 API: `https://api.todoist.com/api/v1` (모든 CRUD 작업)
   - Sync API: `POST /api/v1/sync` (`application/x-www-form-urlencoded` 형식, 리마인더 CRUD 등에 사용)

   **참고**: API v1은 문자열 형식 ID (예: `"6X6HrfVQvQq5WCXH"`)를 사용합니다. 대부분의 리소스 ID는 `z.string()` 타입으로 정의되어 있습니다.

   **리마인더 API**: 리마인더는 전용 REST 엔드포인트가 없으며, Sync API를 통해서만 CRUD 가능합니다. `TodoistClient.sync()` 메서드를 사용합니다. 리마인더 기능은 Todoist Pro/Business 플랜에서만 사용 가능합니다.

5. **Due Date Support**: Tasks support three date formats:
   - `due_string`: Natural language (e.g., "tomorrow at 3pm")
   - `due_date`: YYYY-MM-DD format
   - `due_datetime`: ISO datetime format
   - `deadline_date`: YYYY-MM-DD format for hard deadlines

6. **Pagination**: Most list operations support `cursor` and `limit` parameters

## Development Notes

### Adding New MCP Tools

When adding a new tool to `index.ts`:

1. Determine if it's essential or non-essential
2. If essential, add to `ESSENTIAL_TOOLS` Set
3. If non-essential, wrap with `if (this.shouldRegisterTool('tool_name'))`
4. Follow the existing pattern:
   ```typescript
   this.server.tool(
       'tool_name',
       'Description of what the tool does',
       {
           param1: z.string().describe('Param description'),
           param2: z.number().optional().describe('Optional param')
       },
       async ({ param1, param2 }) => {
           const client = new TodoistClient(this.props.accessToken)
           try {
               const result = await client.get('/endpoint', { param1, param2 })
               return {
                   content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
               }
           } catch (error: unknown) {
               const errorMessage = error instanceof Error ? error.message : 'Unknown error'
               return {
                   content: [{ type: 'text', text: `Error: ${errorMessage}` }],
                   isError: true
               }
           }
       }
   )
   ```

### Todoist API Documentation

Refer to the official Todoist API docs at: https://developer.todoist.com/api/v1/

**Note**: The implementation uses the unified API v1 endpoint (`api.todoist.com/api/v1`). REST API v2 and Sync API v9 were shut down on February 10, 2026.

### Testing the Server

1. Deploy to Cloudflare Workers: `npm run deploy`
2. Visit the worker URL to complete OAuth setup
3. Test using:
   - [Cloudflare AI Playground](https://playground.ai.cloudflare.com/)
   - [MCP Inspector](https://github.com/modelcontextprotocol/inspector)
   - Claude Desktop (via [remote-mcp](https://github.com/geelen/mcp-remote))
   - Claude web custom integration

### Security Considerations

- Access tokens are encrypted and stored in Cloudflare KV
- OAuth 2.0 state parameter prevents CSRF attacks
- No Todoist data is cached; only authorization tokens are stored
- All communications are HTTPS-only
