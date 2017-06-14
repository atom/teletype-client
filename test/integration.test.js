require('./setup')
const assert = require('assert')
const deepEqual = require('deep-equal')
const Buffer = require('./helpers/buffer')
const Editor = require('./helpers/editor')
const Workspace = require('./helpers/workspace')
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

  test('sharing a portal and performing basic collaboration with a guest', async () => {
    const host = buildClient()
    const guest = buildClient()

    const hostPortal = await host.createPortal()

    let hostSetTextCallCount = 0
    const hostBuffer = new Buffer('hello world', {didSetText: () => hostSetTextCallCount++})
    const hostSharedBuffer = await hostPortal.createSharedBuffer({uri: 'uri-1', text: hostBuffer.text})
    hostSharedBuffer.setDelegate(hostBuffer)
    assert.equal(hostSetTextCallCount, 0)

    const hostSharedEditor = await hostPortal.createSharedEditor({
      sharedBuffer: hostSharedBuffer,
      selectionRanges: {
        1: {start: {row: 0, column: 0}, end: {row: 0, column: 5}},
        2: {start: {row: 0, column: 6}, end: {row: 0, column: 11}}
      }
    })
    const hostEditor = new Editor()
    hostSharedEditor.setDelegate(hostEditor)
    assert(!hostEditor.selectionMarkerLayersBySiteId[1])

    await hostPortal.setActiveSharedEditor(hostSharedEditor)

    const guestWorkspace = new Workspace()
    const guestPortal = await guest.joinPortal(hostPortal.id)
    guestPortal.setDelegate(guestWorkspace)

    const guestEditor = new Editor()
    const guestSharedEditor = guestWorkspace.getActiveSharedEditor()
    guestSharedEditor.setDelegate(guestEditor)
    assert.deepEqual(guestEditor.selectionMarkerLayersBySiteId[1], {
      1: {start: {row: 0, column: 0}, end: {row: 0, column: 5}},
      2: {start: {row: 0, column: 6}, end: {row: 0, column: 11}}
    })

    const guestBuffer = new Buffer()
    const guestSharedBuffer = guestSharedEditor.sharedBuffer
    guestSharedBuffer.setDelegate(guestBuffer)
    assert.equal(guestSharedBuffer.uri, 'uri-1')
    assert.equal(guestBuffer.getText(), 'hello world')

    hostSharedBuffer.apply(hostBuffer.insert({row: 0, column: 5}, ' cruel'))
    guestSharedBuffer.apply(guestBuffer.delete({row: 0, column: 0}, {row: 0, column: 5}))
    guestSharedBuffer.apply(guestBuffer.insert({row: 0, column: 0}, 'goodbye'))

    await condition(() => hostBuffer.text === 'goodbye cruel world')
    await condition(() => guestBuffer.text === 'goodbye cruel world')

    hostSharedEditor.setSelectionRanges({
      1: {start: {row: 0, column: 6}, end: {row: 0, column: 11}}
    })
    guestSharedEditor.setSelectionRanges({
      1: {start: {row: 0, column: 2}, end: {row: 0, column: 4}},
      2: {start: {row: 0, column: 6}, end: {row: 0, column: 8}}
    })
    await condition(() => {
      return (
        deepEqual(guestEditor.selectionMarkerLayersBySiteId[1], {1: {start: {row: 0, column: 6}, end: {row: 0, column: 11}}}) &&
        deepEqual(hostEditor.selectionMarkerLayersBySiteId[2], {
          1: {start: {row: 0, column: 2}, end: {row: 0, column: 4}},
          2: {start: {row: 0, column: 6}, end: {row: 0, column: 8}}
        })
      )
    })
  })

  test('switching a portal\'s active editor', async () => {
    const host = buildClient()
    const guest = buildClient()

    const hostPortal = await host.createPortal()
    const hostSharedBuffer1 = await hostPortal.createSharedBuffer({uri: 'buffer-a', text: ''})
    const hostSharedEditor1 = await hostPortal.createSharedEditor({
      sharedBuffer: hostSharedBuffer1,
      selectionRanges: {}
    })
    await hostPortal.setActiveSharedEditor(hostSharedEditor1)

    const guestWorkspace = new Workspace()
    const guestPortal = await guest.joinPortal(hostPortal.id)
    guestPortal.setDelegate(guestWorkspace)
    assert.equal(guestWorkspace.getActiveBufferURI(), 'buffer-a')

    const hostSharedBuffer2 = await hostPortal.createSharedBuffer({uri: 'buffer-b', text: ''})
    const hostSharedEditor2 = await hostPortal.createSharedEditor({
      sharedBuffer: hostSharedBuffer2,
      selectionRanges: {}
    })
    await hostPortal.setActiveSharedEditor(hostSharedEditor2)
    await condition(() => guestWorkspace.getActiveBufferURI() === 'buffer-b')

    await hostPortal.setActiveSharedEditor(hostSharedEditor1)
    await condition(() => guestWorkspace.getActiveBufferURI() === 'buffer-a')
  })

  function buildClient () {
    return new Client({
      restGateway: server.restGateway,
      pubSubGateway: server.pubSubGateway || new PusherPubSubGateway(server.pusherCredentials)
    })
  }
})

function condition (fn) {
  return new Promise((resolve) => {
    setInterval(() => { if (fn()) resolve() }, 5)
  })
}
