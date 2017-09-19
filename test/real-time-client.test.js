require('./setup')
const assert = require('assert')
const Errors = require('../lib/errors')
const RealTimeClient = require('../lib/real-time-client')

suite('RealTimeClient', () => {
  suite('initialize', () => {
    test('waiting too long to retrieve the client id from the pub-sub gateway', async () => {
      const pubSubGateway = {
        getClientId () {
          return new Promise(() => {})
        }
      }
      const client = new RealTimeClient({pubSubGateway, timeoutInMilliseconds: 100})

      let error
      try {
        await client.initialize()
      } catch (e) {
        error = e
      }
      assert(error instanceof Errors.PubSubConnectionError)
    })
  })

  suite('createPortal', () => {
    test('failure response from rest gateway', async () => {
      const stubRestGateway = {
        post: (url, body) => {
          return Promise.resolve({ ok: false, body: {} })
        }
      }
      const client = new RealTimeClient({restGateway: stubRestGateway})

      let error
      try {
        await client.createPortal()
      } catch (e) {
        error = e
      }
      assert(error instanceof Errors.PortalCreationError)
    })
  })
})
