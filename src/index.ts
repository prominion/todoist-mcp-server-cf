import { OAuthProvider } from '@cloudflare/workers-oauth-provider'
import { McpAgent } from 'agents/mcp'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { TodoistAuthHandler } from './todoist-auth-handler.js'
import { TodoistClient } from './TodoistApiClient.js'
// Context from the auth process, encrypted & stored in the auth token
// and provided to the DurableMCP as this.props
type Props = {
    full_name: string
    email: string
    accessToken: string
}

export class TodoistMCP extends McpAgent<Env, unknown, Props> {
    server = new McpServer({
        name: 'Todoist MCP Server - Deployed on Cloudflare',
        version: '1.0.0',
    })

    // Tool filtering configuration to reduce context token usage
    // Setting MINIMAL_TOOL_SET to true exposes only 16 essential tools (~12-15k tokens)
    // Setting it to false exposes all 39 tools (~27k tokens)
    private static readonly MINIMAL_TOOL_SET = true
    private static readonly ESSENTIAL_TOOLS = new Set([
        'create_task', 'get_tasks', 'update_task', 'close_task',
        'get_projects', 'get_project', 'move_task', 'get_tasks_by_filter',
        'create_project', 'update_project', 'get_sections', 'delete_task', 'reopen_task',
        'get_labels', 'create_section', 'update_section',
        'get_completed_tasks_by_completion_date', 'get_completed_tasks_by_due_date'
    ])

    // Helper method to determine if a tool should be registered based on filtering config
    private shouldRegisterTool(toolName: string): boolean {
        return !TodoistMCP.MINIMAL_TOOL_SET || TodoistMCP.ESSENTIAL_TOOLS.has(toolName)
    }

    async init() {
        // Todoist API - Get User Details (non-essential - removed in minimal tool set)
        if (this.shouldRegisterTool('me')) {
            this.server.tool('me', 'Get the user details of the current user from Todoist', {}, async () => {
                return {
                    content: [{ type: 'text', text: JSON.stringify({ email: this.props.email, full_name: this.props.full_name }) }],
                }
            })
        }

        // Get tasks by filter
        this.server.tool(
            'get_tasks_by_filter',
            'Get tasks that match a Todoist filter query',
            {
                filter: z
                    .string()
                    .describe(
                        'Filter by any [supported filter](https://todoist.com/help/articles/introduction-to-filters-V98wIH). Multiple filters (using the comma `,` operator) are not supported.'
                    ),
            },
            async ({ filter }) => {
                const client = new TodoistClient(this.props.accessToken)
                try {
                    const tasks = (await client.get('/tasks', { filter })) as Array<{
                        content: string
                        description: string
                        due?: { date: string }
                    }>

                    // Extract required fields and format the response
                    const formattedTasks = tasks.map((task) => ({
                        content: task.content,
                        description: task.description,
                        due_date: task.due?.date || null,
                    }))

                    return {
                        content: [{ type: 'text', text: JSON.stringify(formattedTasks, null, 2) }],
                    }
                } catch (error: unknown) {
                    console.error('Failed to fetch tasks:', error)
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
                    return {
                        content: [{ type: 'text', text: `Error fetching tasks: ${errorMessage}` }],
                        isError: true,
                    }
                }
            }
        )

        // Project Management Tools

        // Create a new project
        this.server.tool(
            'create_project',
            'Create a new project in Todoist. Returns the created project with its ID and properties.',
            {
                name: z.string().describe('Name of the project to create'),
                description: z.string().optional().describe('Optional description for the project'),
                parent_id: z.string().optional().describe('ID of parent project to nest this project under'),
                color: z.enum([
                    'berry_red', 'red', 'orange', 'yellow', 'olive_green', 'lime_green', 
                    'green', 'mint_green', 'teal', 'sky_blue', 'light_blue', 'blue', 
                    'grape', 'violet', 'lavender', 'magenta', 'salmon', 'charcoal', 'grey', 'taupe'
                ]).optional().describe('Color of the project icon'),
                is_favorite: z.boolean().optional().describe('Whether to mark this project as a favorite'),
                view_style: z.enum(['list', 'board']).optional().describe('Project view style - list or board (kanban) view')
            },
            async ({ name, description, parent_id, color, is_favorite, view_style }) => {
                const client = new TodoistClient(this.props.accessToken)
                try {
                    const project = await client.post('/projects', {
                        name,
                        description,
                        parent_id,
                        color,
                        is_favorite,
                        view_style
                    })
                    return {
                        content: [{ type: 'text', text: JSON.stringify(project, null, 2) }]
                    }
                } catch (error: unknown) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
                    return {
                        content: [{ type: 'text', text: `Error creating project: ${errorMessage}` }],
                        isError: true
                    }
                }
            }
        )

        // Get all projects
        this.server.tool(
            'get_projects',
            'Get all active projects from Todoist. Returns a list of projects with their properties. Supports pagination.',
            {
                cursor: z.string().optional().describe('Pagination cursor from previous response for fetching next page'),
                limit: z.number().min(1).max(200).optional().describe('Number of projects to return per page (default: 50, max: 200)')
            },
            async ({ cursor, limit }) => {
                const client = new TodoistClient(this.props.accessToken)
                try {
                    const params: Record<string, unknown> = {}
                    if (cursor) params.cursor = cursor
                    if (limit) params.limit = limit
                    
                    const response = await client.get('/projects', params)
                    return {
                        content: [{ type: 'text', text: JSON.stringify(response, null, 2) }]
                    }
                } catch (error: unknown) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
                    return {
                        content: [{ type: 'text', text: `Error fetching projects: ${errorMessage}` }],
                        isError: true
                    }
                }
            }
        )

        // Get a single project
        this.server.tool(
            'get_project',
            'Get a specific project by ID from Todoist. Returns detailed information about the project.',
            {
                project_id: z.string().describe('ID of the project to retrieve')
            },
            async ({ project_id }) => {
                const client = new TodoistClient(this.props.accessToken)
                try {
                    const project = await client.get(`/projects/${project_id}`)
                    return {
                        content: [{ type: 'text', text: JSON.stringify(project, null, 2) }]
                    }
                } catch (error: unknown) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
                    return {
                        content: [{ type: 'text', text: `Error fetching project: ${errorMessage}` }],
                        isError: true
                    }
                }
            }
        )

        // Update a project
        this.server.tool(
            'update_project',
            'Update an existing project in Todoist. Only provide the fields you want to update.',
            {
                project_id: z.string().describe('ID of the project to update'),
                name: z.string().optional().describe('New name for the project'),
                description: z.string().optional().describe('New description for the project'),
                color: z.enum([
                    'berry_red', 'red', 'orange', 'yellow', 'olive_green', 'lime_green', 
                    'green', 'mint_green', 'teal', 'sky_blue', 'light_blue', 'blue', 
                    'grape', 'violet', 'lavender', 'magenta', 'salmon', 'charcoal', 'grey', 'taupe'
                ]).optional().describe('New color for the project icon'),
                is_favorite: z.boolean().optional().describe('Whether to mark this project as a favorite'),
                view_style: z.enum(['list', 'board']).optional().describe('Project view style - list or board (kanban) view')
            },
            async ({ project_id, name, description, color, is_favorite, view_style }) => {
                const client = new TodoistClient(this.props.accessToken)
                try {
                    const updateData: Record<string, unknown> = {}
                    if (name !== undefined) updateData.name = name
                    if (description !== undefined) updateData.description = description
                    if (color !== undefined) updateData.color = color
                    if (is_favorite !== undefined) updateData.is_favorite = is_favorite
                    if (view_style !== undefined) updateData.view_style = view_style
                    
                    const project = await client.post(`/projects/${project_id}`, updateData)
                    return {
                        content: [{ type: 'text', text: JSON.stringify(project, null, 2) }]
                    }
                } catch (error: unknown) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
                    return {
                        content: [{ type: 'text', text: `Error updating project: ${errorMessage}` }],
                        isError: true
                    }
                }
            }
        )

        // Project edge case operations (non-essential - removed in minimal tool set)
        if (this.shouldRegisterTool('delete_project')) {
            this.server.tool(
                'delete_project',
                'Delete a project from Todoist. WARNING: This will permanently delete the project and all its sections and tasks.',
                {
                    project_id: z.string().describe('ID of the project to delete')
                },
                async ({ project_id }) => {
                    const client = new TodoistClient(this.props.accessToken)
                    try {
                        await client.delete(`/projects/${project_id}`)
                        return {
                            content: [{ type: 'text', text: 'Project deleted successfully' }]
                        }
                    } catch (error: unknown) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
                        return {
                            content: [{ type: 'text', text: `Error deleting project: ${errorMessage}` }],
                            isError: true
                        }
                    }
                }
            )
        }

        if (this.shouldRegisterTool('archive_project')) {
            this.server.tool(
                'archive_project',
                'Archive a project in Todoist. Archived projects are hidden from the active projects list but can be unarchived later.',
                {
                    project_id: z.string().describe('ID of the project to archive')
                },
                async ({ project_id }) => {
                    const client = new TodoistClient(this.props.accessToken)
                    try {
                        await client.post(`/projects/${project_id}/archive`)
                        return {
                            content: [{ type: 'text', text: 'Project archived successfully' }]
                        }
                    } catch (error: unknown) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
                        return {
                            content: [{ type: 'text', text: `Error archiving project: ${errorMessage}` }],
                            isError: true
                        }
                    }
                }
            )
        }

        if (this.shouldRegisterTool('unarchive_project')) {
            this.server.tool(
                'unarchive_project',
                'Unarchive a previously archived project in Todoist. This will restore the project to the active projects list.',
                {
                    project_id: z.string().describe('ID of the project to unarchive')
                },
                async ({ project_id }) => {
                    const client = new TodoistClient(this.props.accessToken)
                    try {
                        await client.post(`/projects/${project_id}/unarchive`)
                        return {
                            content: [{ type: 'text', text: 'Project unarchived successfully' }]
                        }
                    } catch (error: unknown) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
                        return {
                            content: [{ type: 'text', text: `Error unarchiving project: ${errorMessage}` }],
                            isError: true
                        }
                    }
                }
            )
        }

        if (this.shouldRegisterTool('get_project_collaborators')) {
            this.server.tool(
                'get_project_collaborators',
                'Get all collaborators for a shared project in Todoist. Returns a list of users who have access to the project.',
                {
                    project_id: z.string().describe('ID of the project to get collaborators for')
                },
                async ({ project_id }) => {
                    const client = new TodoistClient(this.props.accessToken)
                    try {
                        const collaborators = await client.get(`/projects/${project_id}/collaborators`)
                        return {
                            content: [{ type: 'text', text: JSON.stringify(collaborators, null, 2) }]
                        }
                    } catch (error: unknown) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
                        return {
                            content: [{ type: 'text', text: `Error fetching collaborators: ${errorMessage}` }],
                            isError: true
                        }
                    }
                }
            )
        }

        // Section Management Tools

        // Section CRUD operations (non-essential - removed in minimal tool set, except get_sections)
        if (this.shouldRegisterTool('create_section')) {
            this.server.tool(
                'create_section',
                'Create a new section within a project in Todoist. Sections help organize tasks within projects.',
                {
                    name: z.string().describe('Name of the section to create'),
                    project_id: z.string().describe('ID of the project where the section will be created'),
                    order: z.number().optional().describe('Position of the section within the project (optional)')
                },
                async ({ name, project_id, order }) => {
                    const client = new TodoistClient(this.props.accessToken)
                    try {
                        const section = await client.post('/sections', {
                            name,
                            project_id,
                            order
                        })
                        return {
                            content: [{ type: 'text', text: JSON.stringify(section, null, 2) }]
                        }
                    } catch (error: unknown) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
                        return {
                            content: [{ type: 'text', text: `Error creating section: ${errorMessage}` }],
                            isError: true
                        }
                    }
                }
            )
        }

        // Get all sections (essential)
        this.server.tool(
            'get_sections',
            'Get all active sections from Todoist. Can filter by project or return all sections across all projects. Supports pagination.',
            {
                project_id: z.string().optional().describe('Filter sections by specific project ID (optional)'),
                cursor: z.string().optional().describe('Pagination cursor from previous response for fetching next page'),
                limit: z.number().min(1).max(200).optional().describe('Number of sections to return per page (default: 50, max: 200)')
            },
            async ({ project_id, cursor, limit }) => {
                const client = new TodoistClient(this.props.accessToken)
                try {
                    const params: Record<string, unknown> = {}
                    if (project_id) params.project_id = project_id
                    if (cursor) params.cursor = cursor
                    if (limit) params.limit = limit

                    const response = await client.get('/sections', params)
                    return {
                        content: [{ type: 'text', text: JSON.stringify(response, null, 2) }]
                    }
                } catch (error: unknown) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
                    return {
                        content: [{ type: 'text', text: `Error fetching sections: ${errorMessage}` }],
                        isError: true
                    }
                }
            }
        )

        if (this.shouldRegisterTool('get_section')) {
            this.server.tool(
                'get_section',
                'Get a specific section by ID from Todoist. Returns detailed information about the section.',
                {
                    section_id: z.string().describe('ID of the section to retrieve')
                },
                async ({ section_id }) => {
                    const client = new TodoistClient(this.props.accessToken)
                    try {
                        const section = await client.get(`/sections/${section_id}`)
                        return {
                            content: [{ type: 'text', text: JSON.stringify(section, null, 2) }]
                        }
                    } catch (error: unknown) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
                        return {
                            content: [{ type: 'text', text: `Error fetching section: ${errorMessage}` }],
                            isError: true
                        }
                    }
                }
            )
        }

        if (this.shouldRegisterTool('update_section')) {
            this.server.tool(
                'update_section',
                'Update an existing section in Todoist. Currently only the section name can be updated.',
                {
                    section_id: z.string().describe('ID of the section to update'),
                    name: z.string().describe('New name for the section')
                },
                async ({ section_id, name }) => {
                    const client = new TodoistClient(this.props.accessToken)
                    try {
                        const section = await client.post(`/sections/${section_id}`, { name })
                        return {
                            content: [{ type: 'text', text: JSON.stringify(section, null, 2) }]
                        }
                    } catch (error: unknown) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
                        return {
                            content: [{ type: 'text', text: `Error updating section: ${errorMessage}` }],
                            isError: true
                        }
                    }
                }
            )
        }

        if (this.shouldRegisterTool('delete_section')) {
            this.server.tool(
                'delete_section',
                'Delete a section from Todoist. WARNING: This will permanently delete the section and all tasks within it.',
                {
                    section_id: z.string().describe('ID of the section to delete')
                },
                async ({ section_id }) => {
                    const client = new TodoistClient(this.props.accessToken)
                    try {
                        await client.delete(`/sections/${section_id}`)
                        return {
                            content: [{ type: 'text', text: 'Section deleted successfully' }]
                        }
                    } catch (error: unknown) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
                        return {
                            content: [{ type: 'text', text: `Error deleting section: ${errorMessage}` }],
                            isError: true
                        }
                    }
                }
            )
        }

        // Task Management Tools

        // Create a new task
        this.server.tool(
            'create_task',
            'Create a new task in Todoist. Tasks are the core items in your to-do list and can be organized in projects and sections.',
            {
                content: z.string().describe('The text content of the task - what needs to be done'),
                description: z.string().optional().describe('Optional detailed description of the task'),
                project_id: z.string().optional().describe('ID of the project to add the task to (defaults to Inbox if not specified)'),
                section_id: z.string().optional().describe('ID of the section within the project to add the task to'),
                parent_id: z.string().optional().describe('ID of the parent task to create this as a sub-task'),
                labels: z.array(z.string()).optional().describe('Array of label names to apply to the task'),
                priority: z.number().min(1).max(4).optional().describe('Task priority: 1 (normal), 2 (high), 3 (very high), 4 (urgent)'),
                due_string: z.string().optional().describe('Due date in natural language (e.g., "tomorrow at 3pm", "next Monday")'),
                due_date: z.string().optional().describe('Due date in YYYY-MM-DD format'),
                due_datetime: z.string().optional().describe('Due date and time in ISO datetime format (e.g., "2023-12-31T15:00:00Z")'),
                deadline_date: z.string().optional().describe('Deadline date in YYYY-MM-DD format (when the task must be completed by, relative to user timezone)'),
                assignee_id: z.string().optional().describe('ID of the user to assign this task to (for shared projects)')
            },
            async ({ content, description, project_id, section_id, parent_id, labels, priority, due_string, due_date, due_datetime, deadline_date, assignee_id }) => {
                const client = new TodoistClient(this.props.accessToken)
                try {
                    const taskData: Record<string, unknown> = { content }
                    if (description) taskData.description = description
                    if (project_id) taskData.project_id = project_id
                    if (section_id) taskData.section_id = section_id
                    if (parent_id) taskData.parent_id = parent_id
                    if (labels) taskData.labels = labels
                    if (priority) taskData.priority = priority
                    if (due_string) taskData.due_string = due_string
                    if (due_date) taskData.due_date = due_date
                    if (due_datetime) taskData.due_datetime = due_datetime
                    if (deadline_date) taskData.deadline_date = deadline_date
                    if (assignee_id) taskData.assignee_id = assignee_id

                    const task = await client.post('/tasks', taskData)
                    return {
                        content: [{ type: 'text', text: JSON.stringify(task, null, 2) }]
                    }
                } catch (error: unknown) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
                    return {
                        content: [{ type: 'text', text: `Error creating task: ${errorMessage}` }],
                        isError: true
                    }
                }
            }
        )

        // Get all tasks
        this.server.tool(
            'get_tasks',
            'Get all active (non-completed) tasks from Todoist. Can filter by project, section, parent task, or label. Supports pagination.',
            {
                project_id: z.string().optional().describe('Filter tasks by specific project ID'),
                section_id: z.string().optional().describe('Filter tasks by specific section ID'),
                parent_id: z.string().optional().describe('Filter tasks by parent task ID (get sub-tasks)'),
                label: z.string().optional().describe('Filter tasks by label name'),
                ids: z.string().optional().describe('Comma-separated list of specific task IDs to retrieve'),
                cursor: z.string().optional().describe('Pagination cursor from previous response for fetching next page'),
                limit: z.number().min(1).max(200).optional().describe('Number of tasks to return per page (default: 50, max: 200)')
            },
            async ({ project_id, section_id, parent_id, label, ids, cursor, limit }) => {
                const client = new TodoistClient(this.props.accessToken)
                try {
                    const params: Record<string, unknown> = {}
                    if (project_id) params.project_id = project_id
                    if (section_id) params.section_id = section_id
                    if (parent_id) params.parent_id = parent_id
                    if (label) params.label = label
                    if (ids) params.ids = ids
                    if (cursor) params.cursor = cursor
                    if (limit) params.limit = limit
                    
                    const response = await client.get('/tasks', params)
                    return {
                        content: [{ type: 'text', text: JSON.stringify(response, null, 2) }]
                    }
                } catch (error: unknown) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
                    return {
                        content: [{ type: 'text', text: `Error fetching tasks: ${errorMessage}` }],
                        isError: true
                    }
                }
            }
        )

        // Get a single task (non-essential - removed in minimal tool set)
        if (this.shouldRegisterTool('get_task')) {
            this.server.tool(
                'get_task',
                'Get a specific active task by ID from Todoist. Returns detailed information about the task including its content, due date, labels, etc.',
                {
                    task_id: z.string().describe('ID of the task to retrieve')
                },
                async ({ task_id }) => {
                    const client = new TodoistClient(this.props.accessToken)
                    try {
                        const task = await client.get(`/tasks/${task_id}`)
                        return {
                            content: [{ type: 'text', text: JSON.stringify(task, null, 2) }]
                        }
                    } catch (error: unknown) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
                        return {
                            content: [{ type: 'text', text: `Error fetching task: ${errorMessage}` }],
                            isError: true
                        }
                    }
                }
            )
        }

        // Update a task
        this.server.tool(
            'update_task',
            'Update an existing task in Todoist. Only provide the fields you want to change - all fields are optional except task_id.',
            {
                task_id: z.string().describe('ID of the task to update'),
                content: z.string().optional().describe('New text content of the task'),
                description: z.string().optional().describe('New description of the task'),
                labels: z.array(z.string()).optional().describe('New array of label names (replaces existing labels)'),
                priority: z.number().min(1).max(4).optional().describe('New priority: 1 (normal), 2 (high), 3 (very high), 4 (urgent)'),
                due_string: z.string().optional().describe('New due date in natural language'),
                due_date: z.string().optional().describe('New due date in YYYY-MM-DD format'),
                due_datetime: z.string().optional().describe('New due date and time in ISO datetime format'),
                deadline_date: z.string().optional().describe('New deadline date in YYYY-MM-DD format (when the task must be completed by, relative to user timezone)'),
                assignee_id: z.string().optional().describe('ID of the user to assign this task to')
            },
            async ({ task_id, content, description, labels, priority, due_string, due_date, due_datetime, deadline_date, assignee_id }) => {
                const client = new TodoistClient(this.props.accessToken)
                try {
                    const updateData: Record<string, unknown> = {}
                    if (content !== undefined) updateData.content = content
                    if (description !== undefined) updateData.description = description
                    if (labels !== undefined) updateData.labels = labels
                    if (priority !== undefined) updateData.priority = priority
                    if (due_string !== undefined) updateData.due_string = due_string
                    if (due_date !== undefined) updateData.due_date = due_date
                    if (due_datetime !== undefined) updateData.due_datetime = due_datetime
                    if (deadline_date !== undefined) updateData.deadline_date = deadline_date
                    if (assignee_id !== undefined) updateData.assignee_id = assignee_id

                    const task = await client.post(`/tasks/${task_id}`, updateData)
                    return {
                        content: [{ type: 'text', text: JSON.stringify(task, null, 2) }]
                    }
                } catch (error: unknown) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
                    return {
                        content: [{ type: 'text', text: `Error updating task: ${errorMessage}` }],
                        isError: true
                    }
                }
            }
        )

        // Delete a task
        this.server.tool(
            'delete_task',
            'Delete a task from Todoist. WARNING: This will permanently delete the task and cannot be undone.',
            {
                task_id: z.string().describe('ID of the task to delete')
            },
            async ({ task_id }) => {
                const client = new TodoistClient(this.props.accessToken)
                try {
                    await client.delete(`/tasks/${task_id}`)
                    return {
                        content: [{ type: 'text', text: 'Task deleted successfully' }]
                    }
                } catch (error: unknown) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
                    return {
                        content: [{ type: 'text', text: `Error deleting task: ${errorMessage}` }],
                        isError: true
                    }
                }
            }
        )

        // Close/complete a task
        this.server.tool(
            'close_task',
            'Mark a task as completed in Todoist. The task will be moved to the completed tasks list and can be reopened later if needed.',
            {
                task_id: z.string().describe('ID of the task to mark as completed')
            },
            async ({ task_id }) => {
                const client = new TodoistClient(this.props.accessToken)
                try {
                    await client.post(`/tasks/${task_id}/close`)
                    return {
                        content: [{ type: 'text', text: 'Task completed successfully' }]
                    }
                } catch (error: unknown) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
                    return {
                        content: [{ type: 'text', text: `Error completing task: ${errorMessage}` }],
                        isError: true
                    }
                }
            }
        )

        // Reopen a task
        this.server.tool(
            'reopen_task',
            'Reopen a previously completed task in Todoist. This will move the task back to your active task list.',
            {
                task_id: z.string().describe('ID of the completed task to reopen')
            },
            async ({ task_id }) => {
                const client = new TodoistClient(this.props.accessToken)
                try {
                    await client.post(`/tasks/${task_id}/reopen`)
                    return {
                        content: [{ type: 'text', text: 'Task reopened successfully' }]
                    }
                } catch (error: unknown) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
                    return {
                        content: [{ type: 'text', text: `Error reopening task: ${errorMessage}` }],
                        isError: true
                    }
                }
            }
        )

        // Move a single task
        this.server.tool(
            'move_task',
            'Move a single task to a different project, section, or make it a sub-task of another task. You must provide at least one destination: project_id, section_id, or parent_id. This is the primary tool for reorganizing individual tasks.',
            {
                task_id: z.string().describe('ID of the task to move'),
                project_id: z.string().optional().describe('ID of the destination project (optional - provide this to move task to a different project)'),
                section_id: z.string().optional().describe('ID of the destination section within a project (optional - provide this to move task to a specific section)'),
                parent_id: z.string().optional().describe('ID of the parent task to make this task a subtask (optional - provide this to create a parent-child relationship)')
            },
            async ({ task_id, project_id, section_id, parent_id }) => {
                const client = new TodoistClient(this.props.accessToken)
                try {
                    // Validate that at least one destination is provided
                    if (!project_id && !section_id && !parent_id) {
                        return {
                            content: [{ type: 'text', text: 'Error: At least one destination must be provided (project_id, section_id, or parent_id)' }],
                            isError: true
                        }
                    }

                    const destination: { project_id?: string; section_id?: string; parent_id?: string } = {}
                    if (project_id) destination.project_id = project_id
                    if (section_id) destination.section_id = section_id
                    if (parent_id) destination.parent_id = parent_id

                    const result = await client.moveTask(task_id, destination)
                    return {
                        content: [{ type: 'text', text: `Task moved successfully.\n${JSON.stringify(result, null, 2)}` }]
                    }
                } catch (error: unknown) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
                    return {
                        content: [{ type: 'text', text: `Error moving task: ${errorMessage}` }],
                        isError: true
                    }
                }
            }
        )

        // Task management - non-essential operations (removed in minimal tool set)
        if (this.shouldRegisterTool('quick_add_task')) {
            this.server.tool(
                'quick_add_task',
                'Quickly add a task using natural language parsing. This allows you to create tasks with due dates, projects, labels, and priorities using natural language (e.g., "Call mom tomorrow at 5pm #personal @phone").',
                {
                    text: z.string().describe('Task text with natural language parsing - can include due dates, project names with #, labels with @, and priorities with p1-p4'),
                    note: z.string().optional().describe('Additional note/description for the task'),
                    reminder: z.string().optional().describe('When to be reminded of this task in natural language'),
                    auto_reminder: z.boolean().optional().describe('Add default reminder for tasks with due times (default: false)')
                },
                async ({ text, note, reminder, auto_reminder }) => {
                    const client = new TodoistClient(this.props.accessToken)
                    try {
                        const quickData: Record<string, unknown> = { text }
                        if (note) quickData.note = note
                        if (reminder) quickData.reminder = reminder
                        if (auto_reminder !== undefined) quickData.auto_reminder = auto_reminder

                        const task = await client.post('/tasks/quick', quickData)
                        return {
                            content: [{ type: 'text', text: JSON.stringify(task, null, 2) }]
                        }
                    } catch (error: unknown) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
                        return {
                            content: [{ type: 'text', text: `Error creating quick task: ${errorMessage}` }],
                            isError: true
                        }
                    }
                }
            )
        }

        // Completed task queries (non-essential - removed in minimal tool set)
        if (this.shouldRegisterTool('get_completed_tasks_by_completion_date')) {
            this.server.tool(
                'get_completed_tasks_by_completion_date',
                'Get tasks that were completed within a specific date range, based on when they were actually completed. Supports filtering and pagination.',
                {
                    since: z.string().describe('Start date for completed tasks in YYYY-MM-DD format'),
                    until: z.string().describe('End date for completed tasks in YYYY-MM-DD format'),
                    project_id: z.string().optional().describe('Filter by specific project ID'),
                    section_id: z.string().optional().describe('Filter by specific section ID'),
                    parent_id: z.string().optional().describe('Filter by parent task ID'),
                    filter_query: z.string().optional().describe('Filter using Todoist query syntax'),
                    filter_lang: z.string().optional().describe('Language for filter query (2-letter code)'),
                    workspace_id: z.number().optional().describe('Filter by workspace ID'),
                    limit: z.number().min(1).max(50).optional().describe('Number of tasks to return (max 50, default: 50)'),
                    cursor: z.string().optional().describe('Pagination cursor for next page')
                },
                async ({ since, until, project_id, section_id, parent_id, filter_query, filter_lang, workspace_id, limit, cursor }) => {
                    const client = new TodoistClient(this.props.accessToken)
                    try {
                        const params: Record<string, unknown> = { since, until }
                        if (project_id) params.project_id = project_id
                        if (section_id) params.section_id = section_id
                        if (parent_id) params.parent_id = parent_id
                        if (filter_query) params.filter_query = filter_query
                        if (filter_lang) params.filter_lang = filter_lang
                        if (workspace_id) params.workspace_id = workspace_id
                        if (limit) params.limit = limit
                        if (cursor) params.cursor = cursor

                        const response = await client.get('/tasks/completed/by_completion_date', params)
                        return {
                            content: [{ type: 'text', text: JSON.stringify(response, null, 2) }]
                        }
                    } catch (error: unknown) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
                        return {
                            content: [{ type: 'text', text: `Error fetching completed tasks: ${errorMessage}` }],
                            isError: true
                        }
                    }
                }
            )
        }

        if (this.shouldRegisterTool('get_completed_tasks_by_due_date')) {
            this.server.tool(
                'get_completed_tasks_by_due_date',
                'Get completed tasks that were originally due within a specific date range. This shows tasks by their original due date, not when they were completed.',
                {
                    since: z.string().describe('Start due date for completed tasks in YYYY-MM-DD format'),
                    until: z.string().describe('End due date for completed tasks in YYYY-MM-DD format'),
                    project_id: z.string().optional().describe('Filter by specific project ID'),
                    section_id: z.string().optional().describe('Filter by specific section ID'),
                    parent_id: z.string().optional().describe('Filter by parent task ID'),
                    filter_query: z.string().optional().describe('Filter using Todoist query syntax'),
                    filter_lang: z.string().optional().describe('Language for filter query (2-letter code)'),
                    workspace_id: z.number().optional().describe('Filter by workspace ID'),
                    limit: z.number().min(1).max(50).optional().describe('Number of tasks to return (max 50, default: 50)'),
                    cursor: z.string().optional().describe('Pagination cursor for next page')
                },
                async ({ since, until, project_id, section_id, parent_id, filter_query, filter_lang, workspace_id, limit, cursor }) => {
                    const client = new TodoistClient(this.props.accessToken)
                    try {
                        const params: Record<string, unknown> = { since, until }
                        if (project_id) params.project_id = project_id
                        if (section_id) params.section_id = section_id
                        if (parent_id) params.parent_id = parent_id
                        if (filter_query) params.filter_query = filter_query
                        if (filter_lang) params.filter_lang = filter_lang
                        if (workspace_id) params.workspace_id = workspace_id
                        if (limit) params.limit = limit
                        if (cursor) params.cursor = cursor

                        const response = await client.get('/tasks/completed/by_due_date', params)
                        return {
                            content: [{ type: 'text', text: JSON.stringify(response, null, 2) }]
                        }
                    } catch (error: unknown) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
                        return {
                            content: [{ type: 'text', text: `Error fetching completed tasks by due date: ${errorMessage}` }],
                            isError: true
                        }
                    }
                }
            )
        }

        // Label Management Tools (all non-essential - removed in minimal tool set)

        if (this.shouldRegisterTool('create_label')) {
            this.server.tool(
                'create_label',
                'Create a new personal label in Todoist. Labels are used to categorize and filter tasks across projects.',
                {
                    name: z.string().describe('Name of the label to create'),
                    color: z.enum([
                        'berry_red', 'red', 'orange', 'yellow', 'olive_green', 'lime_green',
                        'green', 'mint_green', 'teal', 'sky_blue', 'light_blue', 'blue',
                        'grape', 'violet', 'lavender', 'magenta', 'salmon', 'charcoal', 'grey', 'taupe'
                    ]).optional().describe('Color of the label'),
                    order: z.number().optional().describe('Position order of the label'),
                    is_favorite: z.boolean().optional().describe('Whether to mark this label as a favorite')
                },
                async ({ name, color, order, is_favorite }) => {
                    const client = new TodoistClient(this.props.accessToken)
                    try {
                        const labelData: Record<string, unknown> = { name }
                        if (color) labelData.color = color
                        if (order !== undefined) labelData.order = order
                        if (is_favorite !== undefined) labelData.is_favorite = is_favorite

                        const label = await client.post('/labels', labelData)
                        return {
                            content: [{ type: 'text', text: JSON.stringify(label, null, 2) }]
                        }
                    } catch (error: unknown) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
                        return {
                            content: [{ type: 'text', text: `Error creating label: ${errorMessage}` }],
                            isError: true
                        }
                    }
                }
            )
        }

        if (this.shouldRegisterTool('get_labels')) {
            this.server.tool(
                'get_labels',
                'Get all personal labels from Todoist. Returns a list of labels with their properties. Supports pagination.',
                {
                    cursor: z.string().optional().describe('Pagination cursor from previous response for fetching next page'),
                    limit: z.number().min(1).max(200).optional().describe('Number of labels to return per page (default: 50, max: 200)')
                },
                async ({ cursor, limit }) => {
                    const client = new TodoistClient(this.props.accessToken)
                    try {
                        const params: Record<string, unknown> = {}
                        if (cursor) params.cursor = cursor
                        if (limit) params.limit = limit

                        const response = await client.get('/labels', params)
                        return {
                            content: [{ type: 'text', text: JSON.stringify(response, null, 2) }]
                        }
                    } catch (error: unknown) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
                        return {
                            content: [{ type: 'text', text: `Error fetching labels: ${errorMessage}` }],
                            isError: true
                        }
                    }
                }
            )
        }

        if (this.shouldRegisterTool('get_label')) {
            this.server.tool(
                'get_label',
                'Get a specific label by ID from Todoist. Returns detailed information about the label.',
                {
                    label_id: z.number().describe('ID of the label to retrieve (must be a number)')
                },
                async ({ label_id }) => {
                    const client = new TodoistClient(this.props.accessToken)
                    try {
                        const label = await client.get(`/labels/${label_id}`)
                        return {
                            content: [{ type: 'text', text: JSON.stringify(label, null, 2) }]
                        }
                    } catch (error: unknown) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
                        return {
                            content: [{ type: 'text', text: `Error fetching label: ${errorMessage}` }],
                            isError: true
                        }
                    }
                }
            )
        }

        if (this.shouldRegisterTool('update_label')) {
            this.server.tool(
                'update_label',
                'Update an existing personal label in Todoist. Only provide the fields you want to change.',
                {
                    label_id: z.number().describe('ID of the label to update (must be a number)'),
                    name: z.string().optional().describe('New name for the label'),
                    color: z.enum([
                        'berry_red', 'red', 'orange', 'yellow', 'olive_green', 'lime_green',
                        'green', 'mint_green', 'teal', 'sky_blue', 'light_blue', 'blue',
                        'grape', 'violet', 'lavender', 'magenta', 'salmon', 'charcoal', 'grey', 'taupe'
                    ]).optional().describe('New color for the label'),
                    order: z.number().optional().describe('New position order of the label'),
                    is_favorite: z.boolean().optional().describe('Whether to mark this label as a favorite')
                },
                async ({ label_id, name, color, order, is_favorite }) => {
                    const client = new TodoistClient(this.props.accessToken)
                    try {
                        const updateData: Record<string, unknown> = {}
                        if (name !== undefined) updateData.name = name
                        if (color !== undefined) updateData.color = color
                        if (order !== undefined) updateData.order = order
                        if (is_favorite !== undefined) updateData.is_favorite = is_favorite

                        const label = await client.post(`/labels/${label_id}`, updateData)
                        return {
                            content: [{ type: 'text', text: JSON.stringify(label, null, 2) }]
                        }
                    } catch (error: unknown) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
                        return {
                            content: [{ type: 'text', text: `Error updating label: ${errorMessage}` }],
                            isError: true
                        }
                    }
                }
            )
        }

        if (this.shouldRegisterTool('delete_label')) {
            this.server.tool(
                'delete_label',
                'Delete a personal label from Todoist. WARNING: This will remove the label from all tasks that use it.',
                {
                    label_id: z.number().describe('ID of the label to delete (must be a number)')
                },
                async ({ label_id }) => {
                    const client = new TodoistClient(this.props.accessToken)
                    try {
                        await client.delete(`/labels/${label_id}`)
                        return {
                            content: [{ type: 'text', text: 'Label deleted successfully' }]
                        }
                    } catch (error: unknown) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
                        return {
                            content: [{ type: 'text', text: `Error deleting label: ${errorMessage}` }],
                            isError: true
                        }
                    }
                }
            )
        }

        if (this.shouldRegisterTool('get_shared_labels')) {
            this.server.tool(
                'get_shared_labels',
                'Get all shared labels available in Todoist. Shared labels are labels that can be used across different projects and workspaces.',
                {
                    omit_personal: z.boolean().optional().describe('Whether to omit personal labels from the results (default: false)')
                },
                async ({ omit_personal }) => {
                    const client = new TodoistClient(this.props.accessToken)
                    try {
                        const params: Record<string, unknown> = {}
                        if (omit_personal !== undefined) params.omit_personal = omit_personal

                        const response = await client.get('/labels/shared', params)
                        return {
                            content: [{ type: 'text', text: JSON.stringify(response, null, 2) }]
                        }
                    } catch (error: unknown) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
                        return {
                            content: [{ type: 'text', text: `Error fetching shared labels: ${errorMessage}` }],
                            isError: true
                        }
                    }
                }
            )
        }

        if (this.shouldRegisterTool('remove_shared_label')) {
            this.server.tool(
                'remove_shared_label',
                'Remove a shared label from your account. This will stop the shared label from appearing in your label list.',
                {
                    name: z.string().describe('Name of the shared label to remove')
                },
                async ({ name }) => {
                    const client = new TodoistClient(this.props.accessToken)
                    try {
                        await client.post('/labels/shared/remove', { name })
                        return {
                            content: [{ type: 'text', text: 'Shared label removed successfully' }]
                        }
                    } catch (error: unknown) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
                        return {
                            content: [{ type: 'text', text: `Error removing shared label: ${errorMessage}` }],
                            isError: true
                        }
                    }
                }
            )
        }

        if (this.shouldRegisterTool('rename_shared_label')) {
            this.server.tool(
                'rename_shared_label',
                'Rename a shared label in your account. This changes how the shared label appears in your label list.',
                {
                    name: z.string().describe('Current name of the shared label to rename'),
                    new_name: z.string().describe('New name for the shared label')
                },
                async ({ name, new_name }) => {
                    const client = new TodoistClient(this.props.accessToken)
                    try {
                        await client.post('/labels/shared/rename', {
                            name,
                            new_name
                        })
                        return {
                            content: [{ type: 'text', text: 'Shared label renamed successfully' }]
                        }
                    } catch (error: unknown) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
                        return {
                            content: [{ type: 'text', text: `Error renaming shared label: ${errorMessage}` }],
                            isError: true
                        }
                    }
                }
            )
        }

        // Comment Management Tools (all non-essential - removed in minimal tool set)

        if (this.shouldRegisterTool('create_comment')) {
            this.server.tool(
                'create_comment',
                'Create a new comment on a task or project in Todoist. Comments help add context, notes, or updates to tasks and projects. Either task_id or project_id must be provided.',
                {
                    content: z.string().describe('The text content of the comment'),
                    task_id: z.string().optional().describe('ID of the task to comment on (either task_id or project_id is required)'),
                    project_id: z.string().optional().describe('ID of the project to comment on (either task_id or project_id is required)'),
                    attachment: z.object({
                        file_url: z.string().describe('URL of the file to attach'),
                        file_name: z.string().optional().describe('Name of the attached file'),
                        file_type: z.string().optional().describe('MIME type of the attached file'),
                        resource_type: z.string().optional().describe('Type of the attached resource')
                    }).optional().describe('Optional file attachment for the comment')
                },
                async ({ content, task_id, project_id, attachment }) => {
                    const client = new TodoistClient(this.props.accessToken)
                    try {
                        const commentData: Record<string, unknown> = { content }
                        if (task_id) commentData.task_id = task_id
                        if (project_id) commentData.project_id = project_id
                        if (attachment) commentData.attachment = attachment

                        const comment = await client.post('/comments', commentData)
                        return {
                            content: [{ type: 'text', text: JSON.stringify(comment, null, 2) }]
                        }
                    } catch (error: unknown) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
                        return {
                            content: [{ type: 'text', text: `Error creating comment: ${errorMessage}` }],
                            isError: true
                        }
                    }
                }
            )
        }

        if (this.shouldRegisterTool('get_comments')) {
            this.server.tool(
                'get_comments',
                'Get all comments for a specific task or project in Todoist. Either task_id or project_id must be provided. Supports pagination.',
                {
                    task_id: z.string().optional().describe('ID of the task to get comments for (either task_id or project_id is required)'),
                    project_id: z.string().optional().describe('ID of the project to get comments for (either task_id or project_id is required)'),
                    cursor: z.string().optional().describe('Pagination cursor from previous response for fetching next page'),
                    limit: z.number().min(1).max(200).optional().describe('Number of comments to return per page (default: 50, max: 200)')
                },
                async ({ task_id, project_id, cursor, limit }) => {
                    const client = new TodoistClient(this.props.accessToken)
                    try {
                        const params: Record<string, unknown> = {}
                        if (task_id) params.task_id = task_id
                        if (project_id) params.project_id = project_id
                        if (cursor) params.cursor = cursor
                        if (limit) params.limit = limit

                        const response = await client.get('/comments', params)
                        return {
                            content: [{ type: 'text', text: JSON.stringify(response, null, 2) }]
                        }
                    } catch (error: unknown) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
                        return {
                            content: [{ type: 'text', text: `Error fetching comments: ${errorMessage}` }],
                            isError: true
                        }
                    }
                }
            )
        }

        if (this.shouldRegisterTool('get_comment')) {
            this.server.tool(
                'get_comment',
                'Get a specific comment by ID from Todoist. Returns detailed information about the comment including its content, author, and timestamps.',
                {
                    comment_id: z.string().describe('ID of the comment to retrieve')
                },
                async ({ comment_id }) => {
                    const client = new TodoistClient(this.props.accessToken)
                    try {
                        const comment = await client.get(`/comments/${comment_id}`)
                        return {
                            content: [{ type: 'text', text: JSON.stringify(comment, null, 2) }]
                        }
                    } catch (error: unknown) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
                        return {
                            content: [{ type: 'text', text: `Error fetching comment: ${errorMessage}` }],
                            isError: true
                        }
                    }
                }
            )
        }

        if (this.shouldRegisterTool('update_comment')) {
            this.server.tool(
                'update_comment',
                'Update the content of an existing comment in Todoist. Only the comment content can be modified.',
                {
                    comment_id: z.string().describe('ID of the comment to update'),
                    content: z.string().describe('New text content for the comment')
                },
                async ({ comment_id, content }) => {
                    const client = new TodoistClient(this.props.accessToken)
                    try {
                        const comment = await client.post(`/comments/${comment_id}`, { content })
                        return {
                            content: [{ type: 'text', text: JSON.stringify(comment, null, 2) }]
                        }
                    } catch (error: unknown) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
                        return {
                            content: [{ type: 'text', text: `Error updating comment: ${errorMessage}` }],
                            isError: true
                        }
                    }
                }
            )
        }

        if (this.shouldRegisterTool('delete_comment')) {
            this.server.tool(
                'delete_comment',
                'Delete a comment from Todoist. WARNING: This will permanently delete the comment and cannot be undone.',
                {
                    comment_id: z.string().describe('ID of the comment to delete')
                },
                async ({ comment_id }) => {
                    const client = new TodoistClient(this.props.accessToken)
                    try {
                        await client.delete(`/comments/${comment_id}`)
                        return {
                            content: [{ type: 'text', text: 'Comment deleted successfully' }]
                        }
                    } catch (error: unknown) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
                        return {
                            content: [{ type: 'text', text: `Error deleting comment: ${errorMessage}` }],
                            isError: true
                        }
                    }
                }
            )
        }
    }
}

export default new OAuthProvider({
    apiRoute: '/mcp',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    apiHandler: TodoistMCP.serve('/mcp') as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    defaultHandler: TodoistAuthHandler as any,
    authorizeEndpoint: '/authorize',
    tokenEndpoint: '/token',
    clientRegistrationEndpoint: '/register',
})
