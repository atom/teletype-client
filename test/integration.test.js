require('./setup')
const assert = require('assert')
const deepEqual = require('deep-equal')
const Buffer = require('./helpers/buffer')
const Editor = require('./helpers/editor')
const FakePortalDelegate = require('./helpers/fake-portal-delegate')
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

    const guestPortalDelegate = new FakePortalDelegate()
    const guestPortal = await guest.joinPortal(hostPortal.id)
    guestPortal.setDelegate(guestPortalDelegate)

    const guestEditor = new Editor()
    const guestSharedEditor = guestPortalDelegate.getActiveSharedEditor()
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

    const guestPortalDelegate = new FakePortalDelegate()
    const guestPortal = await guest.joinPortal(hostPortal.id)
    guestPortal.setDelegate(guestPortalDelegate)
    assert.equal(guestPortalDelegate.getActiveBufferURI(), 'buffer-a')

    const hostSharedBuffer2 = await hostPortal.createSharedBuffer({uri: 'buffer-b', text: ''})
    const hostSharedEditor2 = await hostPortal.createSharedEditor({
      sharedBuffer: hostSharedBuffer2,
      selectionRanges: {}
    })
    await hostPortal.setActiveSharedEditor(hostSharedEditor2)
    await condition(() => guestPortalDelegate.getActiveBufferURI() === 'buffer-b')

    await hostPortal.setActiveSharedEditor(hostSharedEditor1)
    await condition(() => guestPortalDelegate.getActiveBufferURI() === 'buffer-a')
  })

  test('closing a portal\'s active editor', async () => {
    const host = buildClient()
    const guest = buildClient()

    const hostPortal = await host.createPortal()
    const hostSharedBuffer = await hostPortal.createSharedBuffer({uri: 'some-buffer', text: ''})
    const hostSharedEditor = await hostPortal.createSharedEditor({
      sharedBuffer: hostSharedBuffer,
      selectionRanges: {}
    })

    const guestPortalDelegate = new FakePortalDelegate()
    const guestPortal = await guest.joinPortal(hostPortal.id)
    guestPortal.setDelegate(guestPortalDelegate)

    await hostPortal.setActiveSharedEditor(hostSharedEditor)
    await condition(() => guestPortalDelegate.getActiveSharedEditor() != null)
    assert.equal(guestPortalDelegate.getActiveBufferURI(), 'some-buffer')

    await hostPortal.setActiveSharedEditor(null)
    await condition(() => guestPortalDelegate.getActiveSharedEditor() == null)

    await hostPortal.setActiveSharedEditor(hostSharedEditor)
    await condition(() => guestPortalDelegate.getActiveSharedEditor() != null)
    assert.equal(guestPortalDelegate.getActiveBufferURI(), 'some-buffer')
  })

  test('heartbeat', async function() {
    const HEARTBEAT_INTERVAL_IN_MS = 10
    const EVICTION_PERIOD_IN_MS = 2 * HEARTBEAT_INTERVAL_IN_MS
    server.heartbeatService.setEvictionPeriod(EVICTION_PERIOD_IN_MS)

    const host = buildClient({heartbeatIntervalInMilliseconds: HEARTBEAT_INTERVAL_IN_MS})
    const hostPortal = await host.createPortal()

    const guest1 = buildClient({heartbeatIntervalInMilliseconds: HEARTBEAT_INTERVAL_IN_MS})
    const guest1PortalDelegate = new FakePortalDelegate()
    const guest1Portal = await guest1.joinPortal(hostPortal.id)
    guest1Portal.setDelegate(guest1PortalDelegate)

    const guest2 = buildClient({heartbeatIntervalInMilliseconds: HEARTBEAT_INTERVAL_IN_MS})
    const guest2PortalDelegate = new FakePortalDelegate()
    const guest2Portal = await guest2.joinPortal(hostPortal.id)
    guest2Portal.setDelegate(guest2PortalDelegate)

    const hostSharedBuffer = await hostPortal.createSharedBuffer({uri: 'some-buffer', text: ''})
    const hostEditor = new Editor()
    const hostSharedEditor = await hostPortal.createSharedEditor({
      sharedBuffer: hostSharedBuffer,
      selectionRanges: {}
    })
    hostSharedEditor.setDelegate(hostEditor)
    await hostPortal.setActiveSharedEditor(hostSharedEditor)
    await condition(() => guest1PortalDelegate.getActiveSharedEditor() != null && guest2PortalDelegate.getActiveSharedEditor() != null)

    const guest1SharedEditor = guest1PortalDelegate.getActiveSharedEditor()
    const guest1Editor = new Editor()
    guest1SharedEditor.setDelegate(guest1Editor)
    guest1SharedEditor.setSelectionRanges({1: {start: {row: 0, column: 0}, end: {row: 0, column: 0}}})

    const guest2SharedEditor = guest2PortalDelegate.getActiveSharedEditor()
    const guest2Editor = new Editor()
    guest2SharedEditor.setDelegate(guest2Editor)
    guest2SharedEditor.setSelectionRanges({1: {start: {row: 0, column: 0}, end: {row: 0, column: 0}}})

    await condition(() =>
      hostEditor.selectionMarkerLayersBySiteId[guest1Portal.siteId] != null &&
      hostEditor.selectionMarkerLayersBySiteId[guest2Portal.siteId] != null
    )

    guest1Portal.dispose()
    await condition(() => guest1Portal.heartbeat.isStopped())
    await timeout(EVICTION_PERIOD_IN_MS)
    server.heartbeatService.evictDeadSites()
    await condition(() =>
      hostEditor.selectionMarkerLayersBySiteId[guest1Portal.siteId] == null &&
      guest2Editor.selectionMarkerLayersBySiteId[guest1Portal.siteId] == null
    )
    assert(hostEditor.selectionMarkerLayersBySiteId[guest2Portal.siteId])

    hostPortal.dispose()
    await condition(() => hostPortal.heartbeat.isStopped())
    await timeout(EVICTION_PERIOD_IN_MS)
    assert(!guest2PortalDelegate.hasHostDisconnected())
    server.heartbeatService.evictDeadSites()
    await condition(() => guest2PortalDelegate.hasHostDisconnected())
  })

  function buildClient ({heartbeatIntervalInMilliseconds}={}) {
    return new Client({
      restGateway: server.restGateway,
      pubSubGateway: server.pubSubGateway || new PusherPubSubGateway(server.pusherCredentials),
      heartbeatIntervalInMilliseconds
    })
  }
})

function condition (fn) {
  return new Promise((resolve) => {
    setInterval(() => { if (fn()) resolve() }, 5)
  })
}

function timeout (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
