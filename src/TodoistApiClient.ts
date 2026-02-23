const API_BASE_URL = 'https://api.todoist.com/api/v1'

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504])
const MAX_RETRIES = 3
const MAX_WAIT_MS = 10_000

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

    private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
        let lastResponse: Response | undefined

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            const response = await fetch(url, init)

            if (!RETRYABLE_STATUS_CODES.has(response.status) || attempt === MAX_RETRIES) {
                return response
            }

            lastResponse = response

            let delayMs: number
            if (response.status === 429) {
                const retryAfter = response.headers.get('Retry-After')
                delayMs = retryAfter ? Math.min(parseInt(retryAfter, 10) * 1000, MAX_WAIT_MS) : 1000 * Math.pow(2, attempt)
            } else {
                delayMs = 1000 * Math.pow(2, attempt)
            }

            delayMs = Math.min(delayMs, MAX_WAIT_MS)
            console.log(`Todoist API returned ${response.status}, retrying in ${delayMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`)
            await new Promise((resolve) => setTimeout(resolve, delayMs))
        }

        return lastResponse!
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

        const text = await response.text()
        try {
            return JSON.parse(text)
        } catch {
            throw new Error(`Todoist API returned non-JSON response (${response.status}): ${text.slice(0, 200)}`)
        }
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

        const response = await this.fetchWithRetry(url, {
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

        const response = await this.fetchWithRetry(url, {
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

        const response = await this.fetchWithRetry(url, {
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

        const response = await this.fetchWithRetry(url, {
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
