const {HTTPRequestError} = require('./errors')

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
    const url = this.getAbsoluteURL(relativeURL)
    const response = await window.fetch(url, {method: 'GET', headers: this.getDefaultHeaders()})
    const {ok, status} = response
    const rawBody = await response.text()

    try {
      const body = JSON.parse(rawBody)
      return {ok, body, status}
    } catch (e) {
      const error = new HTTPRequestError('Unexpected response')
      error.diagnosticMessage = getDiagnosticMessage({verb: 'GET', url, status, rawBody})
      throw error
    }
  }

  async post (relativeURL, requestBody) {
    const url = this.getAbsoluteURL(relativeURL)
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

  getAbsoluteURL (relativeURL) {
    return this.baseURL + relativeURL
  }
}

const PORTAL_ID_REGEXP = /[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}/g

function getDiagnosticMessage ({verb, url, status, rawBody}) {
  const diagnosticMessage =
    `URL: GET ${url}\n` +
    `Status Code: ${status}\n` +
    `Body: ${rawBody}`

  return diagnosticMessage.replace(PORTAL_ID_REGEXP, 'REDACTED')
}
