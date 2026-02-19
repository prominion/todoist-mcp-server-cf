const API_BASE_URL = 'https://api.todoist.com/api/v1'

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
            if (value !== undefined && value !== null) {
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
     * Get current user info using the API v1.
     */
    async getCurrentUser(): Promise<{ full_name: string; email: string }> {
        const response = (await this.get('/user')) as { full_name: string; email: string }
        return response
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
     * Make a POST request to the Todoist Sync API endpoint
     * @param formData - Form data as key-value pairs (complex values should be JSON.stringify'd by caller)
     * @returns API response data
     */
    async sync(formData: Record<string, string>): Promise<unknown> {
        const url = `${API_BASE_URL}/sync`
        const body = new URLSearchParams(formData).toString()

        console.log(`Making Sync POST request to: ${url}`)

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.apiToken}`,
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
            },
            body,
        })

        return this.handleResponse(response)
    }
}
