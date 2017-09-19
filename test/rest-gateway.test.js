const assert = require('assert')

const RestGateway = require('../lib/rest-gateway')

suite('RestGateway', () => {
  test("cache responses for the duration specified by the 'Expires' header", async () => {
    const gateway = new RestGateway({baseURL: 'http://example.com'})

    let requestCount = 0
    gateway.fetch = (input, init) => {
      requestCount++

      let body
      switch (input) {
        case 'http://example.com/a':
          body = {a: 'a'}
          break;
        case 'http://example.com/b':
          body = {b: 'b'}
          break;
      }

      return new Response(JSON.stringify(body), {
        status: 200,
        headers: {
          'Expires': new Date(Date.now() + 60000).toUTCString(),
          'Content-Type': 'application/json'
        }
      })
    }

    const callbacks = []
    gateway.setTimeout = (callback, delay) => {
      callbacks.push({callback, delay})
    }

    let response = await gateway.get('/a')
    assert.equal(requestCount, 1)
    assert.equal(callbacks.length, 1)
    assert.deepEqual(response.body, {a: 'a'})

    response = await gateway.get('/b')
    assert.equal(requestCount, 2)
    assert.equal(callbacks.length, 2)
    assert.deepEqual(response.body, {b: 'b'})

    response = await gateway.get('/a')
    assert.equal(requestCount, 2)
    assert.equal(callbacks.length, 2)
    assert.deepEqual(response.body, {a: 'a'})

    response = await gateway.get('/b')
    assert.equal(requestCount, 2)
    assert.equal(callbacks.length, 2)
    assert.deepEqual(response.body, {b: 'b'})

    callbacks.forEach(({delay}) => {
      assert(delay > 59000 && delay < 61000, `TTL of ${delay} is outside of the expected threshold`)
    })

    callbacks.forEach(({callback}) => callback())
    response = await gateway.get('/a')
    assert.equal(requestCount, 3)
    assert.equal(callbacks.length, 3)
    assert.deepEqual(response.body, {a: 'a'})
  })
})
