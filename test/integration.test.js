require('./setup')
const assert = require('assert')
const deepEqual = require('deep-equal')
const Buffer = require('./helpers/buffer')
const Editor = require('./helpers/editor')
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

  test('sharing an editor from a host and fetching its initial state from a guest', async () => {
    const host = new Client({
      restGateway: server.restGateway,
      pubSubGateway: server.pubSubGateway || new PusherPubSubGateway(server.pusherCredentials)
    })
    const hostBuffer = new Buffer('hello world')
    const hostSharedBuffer = await host.createSharedBuffer({uri: 'uri-1', text: hostBuffer.text})
    hostSharedBuffer.setDelegate(hostBuffer)
    const hostSharedEditor = await host.createSharedEditor({
      sharedBuffer: hostSharedBuffer,
      selectionRanges: [
        {start: {row: 0, column: 0}, end: {row: 0, column: 5}},
        {start: {row: 0, column: 6}, end: {row: 0, column: 11}}
      ]
    })
    assert.equal(hostSharedBuffer.uri, 'uri-1')
    assert.equal(hostSharedEditor.sharedBuffer, hostSharedBuffer)

    const guest = new Client({
      restGateway: server.restGateway,
      pubSubGateway: server.pubSubGateway || new PusherPubSubGateway(server.pusherCredentials)
    })
    const guestBuffer = new Buffer()
    const guestEditor = new Editor()
    const guestSharedEditor = await guest.joinSharedEditor(hostSharedEditor.id)
    guestSharedEditor.setDelegate(guestEditor)
    assert.deepEqual(guestEditor.selectionRanges, [
      {start: {row: 0, column: 0}, end: {row: 0, column: 5}},
      {start: {row: 0, column: 6}, end: {row: 0, column: 11}}
    ])

    const guestSharedBuffer = guestSharedEditor.sharedBuffer
    guestSharedBuffer.setDelegate(guestBuffer)
    assert.equal(guestSharedBuffer.uri, 'uri-1')
    assert.equal(guestBuffer.getText(), 'hello world')

    hostSharedBuffer.apply(hostBuffer.insert({row: 0, column: 5}, ' cruel'))
    guestSharedBuffer.apply(guestBuffer.delete({row: 0, column: 0}, {row: 0, column: 5}))
    guestSharedBuffer.apply(guestBuffer.insert({row: 0, column: 0}, 'goodbye'))

    await condition(() => hostBuffer.text === 'goodbye cruel world')
    await condition(() => guestBuffer.text === 'goodbye cruel world')

    hostSharedEditor.setSelectionRanges([{start: {row: 0, column: 6}, end: {row: 0, column: 11}}])
    await condition(() => {
      return deepEqual(guestEditor.selectionRanges, hostSharedEditor.selectionRanges)
    })
  })
})

function condition (fn) {
  return new Promise((resolve) => {
    setInterval(() => { if (fn()) resolve() }, 5)
  })
}
