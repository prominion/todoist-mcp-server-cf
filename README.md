# Todoist MCP Server for Cloudflare

A comprehensive Model Context Protocol (MCP) server for [Todoist](https://www.todoist.com) that provides complete CRUD operations across all major Todoist entities. This server uses OAuth-based authorization and is deployed on Cloudflare Workers for high availability and global performance.

This is a fork and an extension from a proof of concept remote MCP server
implemented by deepakjois (https://github.com/deepakjois/todoist-mcp-server-cf).  Originally had only two basic tools.

Mainly a 1-1 translation of the Todoist API. May be upgraded to have it more
adequate for AI assistants or agents as MCP clients (i.e., fuse multiple API calls instead of calling them individually).
The current functionality relies on the model's capability to associate objects using keys.

This remote server has been tested using Claude's "custom integration" feature.

## 🚀 Features

This MCP server provides **39 tools** (14 essential tools enabled by default) covering a large scope of functionality for:

### **📁 Project Management**
- **CRUD Operations**: Create, read, update, and delete projects
- **Project Organization**: Archive/unarchive projects, manage nested projects with parent-child relationships
- **Collaboration**: Get project collaborators for shared projects
- **Customization**: Set project colors, view styles (list/board), and favorite status

### **📋 Section Management**
- **CRUD Operations**: Create, read, update, and delete sections within projects
- **Organization**: Order sections within projects for better task organization
- **Filtering**: Get sections by project or across all projects

### **✅ Task Management**
- **CRUD Operations**: Create, read, update, and delete tasks
- **Task States**: Complete/close tasks, reopen completed tasks
- **Organization**: Move tasks between projects/sections, create sub-tasks
- **Smart Creation**: Quick add with natural language parsing (e.g., "Call mom tomorrow at 5pm #personal @phone")
- **Due Dates**: Support for natural language, specific dates, and datetime formats
- **Advanced Queries**: Filter tasks using Todoist's powerful filter syntax
- **Completion Tracking**: Get completed tasks by completion date or original due date
- **Assignments**: Assign tasks to collaborators in shared projects

### **🏷️ Label Management**
- **Personal Labels**: Full CRUD operations for personal labels
- **Shared Labels**: Access, remove, and rename shared workspace labels
- **Customization**: 20+ color options, ordering, and favorite status
- **Organization**: Categorize and filter tasks across projects using labels

### **💬 Comment Management**
- **CRUD Operations**: Create, read, update, and delete comments
- **Versatility**: Comment on both tasks and projects
- **Attachments**: Support for file attachments with comments
- **Collaboration**: Add context and updates to shared work

### **🔍 Advanced Capabilities**
- **Pagination**: All list operations support pagination for large datasets
- **Error Handling**: Comprehensive error reporting with detailed messages
- **Validation**: Strong type validation using Zod schemas
- **Natural Language**: Support for natural language date parsing and quick task creation
- **Filtering**: Advanced filtering using Todoist's query syntax
- **OAuth Security**: Secure OAuth 2.0 authentication flow

## 🔧 Technical Specifications

- **Protocol**: Model Context Protocol (MCP) over Streamable HTTP
- **Authentication**: OAuth 2.0 with Todoist
- **Deployment**: Cloudflare Workers with global edge distribution
- **Storage**: Cloudflare KV for secure token storage
- **Language**: TypeScript with full type safety
- **Validation**: Zod schemas for parameter validation

## 🌐 How to Access

**Server URL**: `https://<your-cloudflare-worker-url>/mcp`

### Usage Options:
- **[Cloudflare AI Playground](https://playground.ai.cloudflare.com/)**: Direct browser access
- **[MCP Inspector](https://github.com/modelcontextprotocol/inspector)**: Development and testing tool
- **Claude Desktop**: Via [remote-mcp](https://github.com/geelen/mcp-remote) proxy (until native remote MCP support)
- **Claude web**: When deployed, integrates with the "custom integration" feature.
- **Other MCP Clients**: Any MCP-compatible client supporting remote servers

## 🛠️ Deploy Your Own Instance

For maximum security and control, deploy your own instance:

### Prerequisites:
1. **Cloudflare Account**: With Workers plan
2. **Todoist Developer App**: Create at [Todoist App Console](https://developer.todoist.com/appconsole.html)
   - OAuth redirect URL: `https://<your-worker-url>/callback`

### Deployment Steps:

1. **Clone and Setup**:
   ```bash
   git clone <this-repo>
   cd todoist-mcp-server-cf
   npm install
   ```

2. **Configure Secrets**:
   ```bash
   wrangler secret put TODOIST_CLIENT_ID
   wrangler secret put TODOIST_CLIENT_SECRET
   ```
   Wrangler will ask you to create a new worker if necessary

3. **Update Configuration**:
   - Copy `wrangler.jsonc.example` to `wrangler.jsonc`
   - Edit `wrangler.jsonc` as a local configuration
   - Update KV namespace ID to your own
   - Modify worker name and route as needed

4. **Deploy**:
   ```bash
   npm run deploy
   ```

5. **Verify**: Visit your worker URL to complete OAuth setup

## 🔒 Security & Privacy

- **OAuth 2.0**: Industry-standard secure authentication
- **Token Encryption**: Access tokens encrypted in Cloudflare KV storage
- **No Data Storage**: Only authorization tokens stored, no Todoist data cached
- **HTTPS Only**: All communications encrypted in transit
- **Self-Hosted**: Deploy your own instance for complete control

## 📄 License

MIT License - see LICENSE.md for details
