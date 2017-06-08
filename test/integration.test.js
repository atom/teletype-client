require('./setup')
const assert = require('assert')
const Buffer = require('./helpers/buffer')
const Client = require('../lib/real-time-client')
const PusherPubSubGateway = require('../lib/pusher-pub-sub-gateway')
const {startTestServer} = require('@atom-team/real-time-server')

suite('Client Integration', () => {
  let server

  suiteSetup(async () => {
    const params = {
      databaseURL: process.env.TEST_DATABASE_URL,
      maxMessageSizeInBytes: 100
    }
    // Uncomment and provide credentials to test against Pusher.
    // params.pusherCredentials = {
    //   appId: '123',
    //   key: '123',
    //   secret: '123'
    // }
    server = await startTestServer(params)
  })

  suiteTeardown(() => {
    return server.stop()
  })

  setup(() => {
    return server.reset()
  })

  test('sharing a buffer from a host and fetching its initial state from a guest', async () => {
    const host = new Client({
      restGateway: server.restGateway,
      pubSubGateway: server.pubSubGateway || new PusherPubSubGateway(server.pusherCredentials)
    })
    const hostBuffer = new Buffer('hello world')
    const hostSharedBuffer = await host.createSharedBuffer({uri: 'uri-1', delegate: hostBuffer})
    assert.equal(hostSharedBuffer.uri, 'uri-1')

    const guest = new Client({
      restGateway: server.restGateway,
      pubSubGateway: server.pubSubGateway || new PusherPubSubGateway(server.pusherCredentials)
    })
    const guestBuffer = new Buffer('')
    const guestSharedBuffer = await guest.joinSharedBuffer(hostSharedBuffer.id, guestBuffer)
    assert.equal(guestSharedBuffer.uri, 'uri-1')
    assert.equal(guestBuffer.getText(), 'hello world')

    hostSharedBuffer.apply(hostBuffer.insert({row: 0, column: 5}, ' cruel'))
    guestSharedBuffer.apply(guestBuffer.delete({row: 0, column: 0}, {row: 0, column: 5}))
    guestSharedBuffer.apply(guestBuffer.insert({row: 0, column: 0}, 'goodbye'))

    await hostBuffer.whenTextEquals('goodbye cruel world')
    await guestBuffer.whenTextEquals('goodbye cruel world')
  })
})
