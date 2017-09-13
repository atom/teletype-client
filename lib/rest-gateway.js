const {URL} = require('url')

module.exports =
class RestGateway {
  constructor ({baseURL}) {
    this.baseURL = baseURL
  }

  async get (relativeURL) {
    const url = new URL(relativeURL, this.baseURL).toString()
    const response = await window.fetch(url, {
      method: 'GET',
      headers: {'Accept': 'application/json'}
    })

    return {body: await response.json(), ok: response.ok}
  }

  async post (relativeURL, body) {
    const url = new URL(relativeURL, this.baseURL).toString()
    const response = await window.fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })

    return {body: await response.json(), ok: response.ok}
  }
}
