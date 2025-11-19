const API_BASE_URL = 'https://api.todoist.com/rest/v2'
const SYNC_API_URL = 'https://api.todoist.com/sync/v9/sync'

export class TodoistClient {
    private readonly apiToken: string

    constructor(apiToken: string) {
        this.apiToken = apiToken
    }

    private getHeaders(includeContentType = false): HeadersInit {
        const headers: HeadersInit = {
            Authorization: `Bearer ${this.apiToken}`,
            Accept: 'application/json',
        }

        if (includeContentType) {
            headers['Content-Type'] = 'application/json'
        }

        return headers
    }

    private async handleResponse(response: Response) {
        if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`Todoist API error (${response.status}): ${errorText}`)
        }

        // For 204 No Content responses
        if (response.status === 204) {
            return null
        }

        return response.json()
    }

    /**
     * Make a GET request to Todoist API
     * @param endpoint - API endpoint path (without base URL)
     * @param params - Query parameters object
     * @returns API response data
     */
    async get(endpoint: string, params: Record<string, unknown> = {}): Promise<unknown> {
        let url = `${API_BASE_URL}${endpoint}`

        const queryParams = new URLSearchParams()
        for (const [key, value] of Object.entries(params)) {
            if (value) {
                queryParams.append(key, String(value))
            }
        }

        const queryString = queryParams.toString()
        if (queryString) {
            url += `?${queryString}`
        }

        console.log(`Making GET request to: ${url}`)

        const response = await fetch(url, {
            method: 'GET',
            headers: this.getHeaders(),
        })

        return this.handleResponse(response)
    }

    /**
     * Make a POST request to Todoist API
     * @param endpoint - API endpoint path (without base URL)
     * @param data - Request body data
     * @returns API response data
     */
    async post(endpoint: string, data: Record<string, unknown> = {}): Promise<unknown> {
        const url = `${API_BASE_URL}${endpoint}`

        console.log(`Making POST request to: ${url} with data:`, JSON.stringify(data, null, 2))

        const response = await fetch(url, {
            method: 'POST',
            headers: this.getHeaders(true),
            body: JSON.stringify(data),
        })

        return this.handleResponse(response)
    }

    /**
     * Make a DELETE request to Todoist API
     * @param endpoint - API endpoint path (without base URL)
     * @returns API response data
     */
    async delete(endpoint: string): Promise<unknown> {
        const url = `${API_BASE_URL}${endpoint}`

        console.log(`Making DELETE request to: ${url}`)

        const response = await fetch(url, {
            method: 'DELETE',
            headers: this.getHeaders(),
        })

        return this.handleResponse(response)
    }

    /**
     * Move a task using Sync API
     * @param taskId - ID of the task to move
     * @param destination - Object containing project_id, section_id, or parent_id
     * @returns Sync API response
     */
    async moveTask(taskId: string, destination: { project_id?: string; section_id?: string; parent_id?: string }): Promise<unknown> {
        const uuid = crypto.randomUUID()

        const args: Record<string, string> = { id: taskId }
        if (destination.project_id) args.project_id = destination.project_id
        if (destination.section_id) args.section_id = destination.section_id
        if (destination.parent_id) args.parent_id = destination.parent_id

        const commands = [{
            type: 'item_move',
            uuid: uuid,
            args: args
        }]

        console.log(`Making Sync API request to move task ${taskId}:`, JSON.stringify(commands, null, 2))

        const response = await fetch(SYNC_API_URL, {
            method: 'POST',
            headers: this.getHeaders(true),
            body: JSON.stringify({ commands })
        })

        if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`Todoist Sync API error (${response.status}): ${errorText}`)
        }

        const result = await response.json() as { sync_status: Record<string, string> }

        // Check if the command was successful
        if (result.sync_status && result.sync_status[uuid] !== 'ok') {
            throw new Error(`Move task failed: ${JSON.stringify(result.sync_status[uuid])}`)
        }

        return result
    }
}
