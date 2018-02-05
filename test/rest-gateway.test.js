require('./setup')
const assert = require('assert')
const http = require('http')
const Errors = require('../lib/errors')
const RestGateway = require('../lib/rest-gateway')

suite('RestGateway', () => {
  const servers = []

  teardown(() => {
    for (const server of servers) {
      server.close()
    }
    servers.length = 0
  })

  suite('get', () => {
    test('successful request and response', async () => {
      const address = listen(function (request, response) {
         response.writeHead(200, {'Content-Type': 'application/json'})
         response.write('{"a": 1}')
         response.end()
      })

      const gateway = new RestGateway({baseURL: address})
      const response = await gateway.get('/')
      assert(response.ok)
      assert.deepEqual(response.body, {a: 1})
    })

    test('failed request', async () => {
      const gateway = new RestGateway({baseURL: 'http://localhost:0987654321'})
      let error
      try {
        await gateway.get('/foo/b9e13e6b-9e6e-492c-b4d9-4ec75fd9c2bc/bar')
      } catch (e) {
        error = e
      }
      assert(error instanceof Errors.HTTPRequestError)
      assert(error.diagnosticMessage.includes('GET'))
      assert(error.diagnosticMessage.includes('/foo/REDACTED/bar'))
    })

    test('non-JSON response', async () => {
      const address = listen(function (request, response) {
        response.writeHead(200, {'Content-Type': 'text/plain'})
        response.write('some unexpected response (b9e13e6b-9e6e-492c-b4d9-4ec75fd9c2bc)')
        response.end()
      })

      const gateway = new RestGateway({baseURL: address})
      let error
      try {
        await gateway.get('/foo/b9e13e6b-9e6e-492c-b4d9-4ec75fd9c2bc/bar')
      } catch (e) {
        error = e
      }
      assert(error instanceof Errors.HTTPRequestError)
      assert(error.diagnosticMessage.includes('GET'))
      assert(error.diagnosticMessage.includes('/foo/REDACTED/bar'))
      assert(error.diagnosticMessage.includes('200'))
      assert(error.diagnosticMessage.includes('some unexpected response (REDACTED)'))
    })
  })

  suite('post', () => {
    test('successful request and response', async () => {
      const address = listen(function (request, response) {
         response.writeHead(200, {'Content-Type': 'application/json'})
         response.write('{"a": 1}')
         response.end()
      })

      const gateway = new RestGateway({baseURL: address})
      const response = await gateway.post('/')
      assert(response.ok)
      assert.deepEqual(response.body, {a: 1})
    })

    test('failed request', async () => {
      const gateway = new RestGateway({baseURL: 'http://localhost:0987654321'})
      let error
      try {
        await gateway.post('/foo/b9e13e6b-9e6e-492c-b4d9-4ec75fd9c2bc/bar', { "a": 1 })
      } catch (e) {
        error = e
      }
      assert(error instanceof Errors.HTTPRequestError)
      assert(error.diagnosticMessage.includes('POST'))
      assert(error.diagnosticMessage.includes('/foo/REDACTED/bar'))
    })

    test('non-JSON response', async () => {
      const address = listen(function (request, response) {
        response.writeHead(200, {'Content-Type': 'text/plain'})
        response.write('some unexpected response (b9e13e6b-9e6e-492c-b4d9-4ec75fd9c2bc)')
        response.end()
      })

      const gateway = new RestGateway({baseURL: address})
      let error
      try {
        await gateway.post('/foo/b9e13e6b-9e6e-492c-b4d9-4ec75fd9c2bc/bar')
      } catch (e) {
        error = e
      }
      assert(error instanceof Errors.HTTPRequestError)
      assert(error.diagnosticMessage.includes('POST'))
      assert(error.diagnosticMessage.includes('/foo/REDACTED/bar'))
      assert(error.diagnosticMessage.includes('200'))
      assert(error.diagnosticMessage.includes('some unexpected response (REDACTED)'))
    })
  })

  function listen (requestListener) {
    const server = http.createServer(requestListener).listen(0)
    servers.push(server)
    return `http://localhost:${server.address().port}`
  }
})
