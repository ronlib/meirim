import axios from 'axios'

const instance = axios.create({
	"baseURL": process.env.REACT_APP_BASE_API_URL,
	"withCredentials": true
})

instance.interceptors.request.use((config) => {
	console.log('[API]', config.method.toUpperCase(), config.baseURL + config.url, config.params || config.data || '')
	return config
})

instance.interceptors.response.use(
	(response) => {
		console.log('[API]', response.status, response.config.url)
		return response
	},
	(error) => {
		if (error.response) {
			console.error('[API] ERROR', error.response.status, error.response.config.url, error.response.data)
		} else {
			console.error('[API] ERROR', error.message)
		}
		return Promise.reject(error)
	}
)

export default {
	get: (path, data, options) => instance.get(path, { params: data }, options)
		.then(results => results.data),
	post: (path, data, options) => instance.post(path, data, options)
		.then(results => results.data),
	delete: (path, options) => instance.delete(path, options)
		.then(results => results.data),
}
