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

  get (relativeURL, options) {
    return this.fetch(relativeURL, {
      method: 'GET',
      headers: this.getDefaultHeaders()
    })
  }

  post (relativeURL, requestBody) {
    return this.fetch(relativeURL, {
      method: 'POST',
      headers: Object.assign(this.getDefaultHeaders(), {'Content-Type': 'application/json'}),
      body: JSON.stringify(requestBody)
    })
  }

  async fetch (relativeURL, {method, headers, body}) {
    const url = this.getAbsoluteURL(relativeURL)
    let response
    try {
      response = await window.fetch(url, {method, headers, body})
    } catch (e) {
      const error = new HTTPRequestError('Connection failure')
      error.diagnosticMessage = getDiagnosticMessage({method, url})
      throw error
    }

    const {ok, status} = response
    const rawBody = await response.text()

    try {
      const body = JSON.parse(rawBody)
      return {ok, body, status}
    } catch (e) {
      const error = new HTTPRequestError('Unexpected response')
      error.diagnosticMessage = getDiagnosticMessage({method, url, status, rawBody})
      throw error
    }
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

function getDiagnosticMessage ({method, url, status, rawBody}) {
  let message = `Request: ${method} ${url}`
  if (status) message += `\nStatus Code: ${status}`
  if (rawBody) message += `\nBody: ${rawBody}`
  return message.replace(PORTAL_ID_REGEXP, 'REDACTED')
}
