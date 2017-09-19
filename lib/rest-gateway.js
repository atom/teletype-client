const {URL} = require('url')

module.exports =
class RestGateway {
  constructor ({baseURL}) {
    this.baseURL = baseURL
    this.cache = new Map()
  }

  async get (relativeURL) {
    const cachedResults = this.cache.get(relativeURL)
    if (cachedResults) {
      return {body: cachedResults, ok: true}
    }

    const url = new URL(relativeURL, this.baseURL).toString()
    const response = await this.fetch(url, {
      method: 'GET',
      headers: {'Accept': 'application/json'}
    })

    const body = await response.json()

    const expirationTimestamp = response.headers.get('Expires')
    if (expirationTimestamp) {
      this.cache.set(relativeURL, body)

      const expirationDate = new Date(expirationTimestamp)
      const ttl = expirationDate - Date.now()
      this.setTimeout(() => {this.cache.delete(relativeURL)}, ttl) // TODO Clear this timeout when we destroy a RestGateway object
    }

    return {body, ok: response.ok}
  }

  async post (relativeURL, body) {
    const url = new URL(relativeURL, this.baseURL).toString()
    const response = await this.fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })

    return {
      body: await response.json(),
      ok: response.ok
    }
  }

  fetch (input, init) {
    return window.fetch(input, init)
  }

  setTimeout (callback, delay) {
    return window.setTimeout(callback, delay)
  }
}
