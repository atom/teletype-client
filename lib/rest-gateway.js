const {URL} = require('url')

module.exports =
class RestGateway {
  constructor ({baseURL, oauthToken}) {
    this.baseURL = baseURL
    this.oauthToken = oauthToken
  }

  setOauthToken (oauthToken) {
    this.oauthToken = oauthToken
  }

  async get (relativeURL, options) {
    const url = new URL(relativeURL, this.baseURL).toString()
    const response = await window.fetch(url, {method: 'GET', headers: this.getDefaultHeaders()})
    const {ok, status} = response
    const body = await response.json()
    return {ok, body, status}
  }

  async post (relativeURL, requestBody) {
    const url = new URL(relativeURL, this.baseURL).toString()
    const response = await window.fetch(url, {
      method: 'POST',
      headers: Object.assign(this.getDefaultHeaders(), {'Content-Type': 'application/json'}),
      body: JSON.stringify(requestBody)
    })

    const {ok, status} = response
    const body = await response.json()
    return {ok, body, status}
  }

  getDefaultHeaders () {
    const headers = {'Accept': 'application/json'}
    if (this.oauthToken) headers['GitHub-OAuth-token'] = this.oauthToken

    return headers
  }
}
