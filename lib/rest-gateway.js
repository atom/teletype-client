const {URL} = require('url')

module.exports =
class RestGateway {
  constructor ({baseURL}) {
    this.baseURL = baseURL
  }

  async get (relativeURL, options) {
    const url = new URL(relativeURL, this.baseURL).toString()
    const headers = Object.assign({'Accept': 'application/json'}, options && options.headers)
    const response = await window.fetch(url, {method: 'GET', headers})
    const {ok, status} = response
    const body = await response.json()
    return {ok, body, status}
  }

  async post (relativeURL, requestBody) {
    const url = new URL(relativeURL, this.baseURL).toString()
    const response = await window.fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    })

    const {ok, status} = response
    const body = await response.json()
    return {ok, body, status}
  }
}
