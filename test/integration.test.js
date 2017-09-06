require('./setup')
const assert = require('assert')
const deepEqual = require('deep-equal')
const Buffer = require('./helpers/buffer')
const Editor = require('./helpers/editor')
const FakePortalDelegate = require('./helpers/fake-portal-delegate')
const getExampleMediaStream = require('./helpers/get-example-media-stream')
const RealTimeClient = require('../lib/real-time-client')
const PusherPubSubGateway = require('../lib/pusher-pub-sub-gateway')
const {startTestServer} = require('@atom/real-time-server')

let testEpoch = 0

suite('Client Integration', () => {
  let server, portals, conditionErrorMessage

  suiteSetup(async () => {
    const params = {databaseURL: process.env.TEST_DATABASE_URL}
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
    conditionErrorMessage = null
    portals = []
    return server.reset()
  })

  teardown(async () => {
    if (conditionErrorMessage) {
      console.error('Condition failed with error message: ', conditionErrorMessage)
    }

    for (const portal of portals) {
      await portal.dispose()
      portal.peerPool.disconnect()
    }

    testEpoch++
  })

  test('sharing a portal and performing basic collaboration with a guest', async () => {
    const host = await buildClient()
    const guest = await buildClient()

    const hostPortal = await host.createPortal()

    let hostSetTextCallCount = 0
    const hostBuffer = new Buffer('hello world', {didSetText: () => hostSetTextCallCount++})
    const hostClientBuffer = await hostPortal.createTextBuffer({uri: 'uri-1', text: hostBuffer.text})
    hostClientBuffer.setDelegate(hostBuffer)
    hostClientBuffer.setTextInRange(...hostBuffer.insert({row: 0, column: 11}, '!'))
    assert.equal(hostSetTextCallCount, 0)

    const hostClientEditor = await hostPortal.createTextEditor({
      textBuffer: hostClientBuffer,
      selections: {
        1: {range: {start: {row: 0, column: 0}, end: {row: 0, column: 5}}},
        2: {range: {start: {row: 0, column: 6}, end: {row: 0, column: 11}}}
      }
    })
    const hostEditor = new Editor(hostBuffer)
    hostClientEditor.setDelegate(hostEditor)
    assert(!hostEditor.getSelections(1))
    await hostPortal.setActiveTextEditor(hostClientEditor)

    const guestPortalDelegate = new FakePortalDelegate()
    const guestPortal = await guest.joinPortal(hostPortal.id)
    guestPortal.setDelegate(guestPortalDelegate)

    const guestClientEditor = guestPortalDelegate.getActiveTextEditor()
    const guestClientBuffer = guestClientEditor.textBuffer

    const guestBuffer = new Buffer()
    guestClientBuffer.setDelegate(guestBuffer)
    const guestEditor = new Editor(guestBuffer)
    guestClientEditor.setDelegate(guestEditor)

    assert.deepEqual(guestEditor.getSelections(1), {
      1: {
        range: {start: {row: 0, column: 0}, end: {row: 0, column: 5}},
        exclusive: false,
        reversed: false,
        tailed: true
      },
      2: {
        range: {start: {row: 0, column: 6}, end: {row: 0, column: 11}},
        exclusive: false,
        reversed: false,
        tailed: true
      }
    })
    assert.equal(guestClientBuffer.uri, 'uri-1')
    assert.equal(guestBuffer.getText(), 'hello world!')
    hostClientBuffer.setTextInRange(...hostBuffer.insert({row: 0, column: 5}, ' cruel'))
    guestClientBuffer.setTextInRange(...guestBuffer.delete({row: 0, column: 0}, {row: 0, column: 5}))
    guestClientBuffer.setTextInRange(...guestBuffer.insert({row: 0, column: 0}, 'goodbye'))

    await condition(() => hostBuffer.text === 'goodbye cruel world!')
    await condition(() => guestBuffer.text === 'goodbye cruel world!')

    hostClientEditor.updateSelections({
      1: {
        range: {start: {row: 0, column: 6}, end: {row: 0, column: 11}}
      },
      2: null
    })
    guestClientEditor.updateSelections({
      1: {
        range: {start: {row: 0, column: 2}, end: {row: 0, column: 4}}
      },
      2: {
        range: {start: {row: 0, column: 6}, end: {row: 0, column: 8}}
      }
    })

    const expectedGuestSelectionsOnHost = {
      1: {
        range: {start: {row: 0, column: 2}, end: {row: 0, column: 4}},
        exclusive: false,
        reversed: false,
        tailed: true
      },
      2: {
        range: {start: {row: 0, column: 6}, end: {row: 0, column: 8}},
        exclusive: false,
        reversed: false,
        tailed: true
      }
    }

    const expectedHostSelectionsOnGuest = {
      1: {
        range: {start: {row: 0, column: 6}, end: {row: 0, column: 11}},
        exclusive: false,
        reversed: false,
        tailed: true
      }
    }

    await condition(() => {
      return (
        deepEqual(guestEditor.getSelections(1), expectedHostSelectionsOnGuest) &&
        deepEqual(hostEditor.getSelections(2), expectedGuestSelectionsOnHost)
      )
    })
  })

  test('switching a portal\'s active editor', async () => {
    const host = await buildClient()
    const guest = await buildClient()

    const hostPortal = await host.createPortal()
    const hostBuffer1 = await hostPortal.createTextBuffer({uri: 'buffer-a', text: ''})
    const hostEditor1 = await hostPortal.createTextEditor({textBuffer: hostBuffer1, selectionRanges: {}})
    hostPortal.setActiveTextEditor(hostEditor1)

    const guestPortalDelegate = new FakePortalDelegate()
    const guestPortal = await guest.joinPortal(hostPortal.id)
    guestPortal.setDelegate(guestPortalDelegate)
    assert.equal(guestPortalDelegate.getActiveTextBufferURI(), 'buffer-a')
    const guestEditor1 = guestPortalDelegate.getActiveTextEditor()

    const hostBuffer2 = await hostPortal.createTextBuffer({uri: 'buffer-b', text: ''})
    const hostEditor2 = await hostPortal.createTextEditor({textBuffer: hostBuffer2, selectionRanges: {}})
    hostPortal.setActiveTextEditor(hostEditor2)
    await condition(() => guestPortalDelegate.getActiveTextBufferURI() === 'buffer-b')
    const guestEditor2 = guestPortalDelegate.getActiveTextEditor()

    hostPortal.setActiveTextEditor(hostEditor1)
    await condition(() => guestPortalDelegate.getActiveTextBufferURI() === 'buffer-a')
    assert.equal(guestPortalDelegate.getActiveTextEditor(), guestEditor1)
  })

  test('closing a portal\'s active editor', async () => {
    const host = await buildClient()
    const guest = await buildClient()

    const hostPortal = await host.createPortal()
    const hostBuffer = await hostPortal.createTextBuffer({uri: 'some-buffer', text: ''})
    const hostEditor = await hostPortal.createTextEditor({textBuffer: hostBuffer, selectionRanges: {}})

    const guestPortalDelegate = new FakePortalDelegate()
    const guestPortal = await guest.joinPortal(hostPortal.id)
    guestPortal.setDelegate(guestPortalDelegate)
    assert(guestPortalDelegate.getActiveTextEditor() === null)

    await hostPortal.setActiveTextEditor(hostEditor)
    await condition(() => guestPortalDelegate.getActiveTextEditor() != null)
    assert.equal(guestPortalDelegate.getActiveTextBufferURI(), 'some-buffer')

    await hostPortal.setActiveTextEditor(null)
    await condition(() => guestPortalDelegate.getActiveTextEditor() == null)

    await hostPortal.setActiveTextEditor(hostEditor)
    await condition(() => guestPortalDelegate.getActiveTextEditor() != null)
    assert.equal(guestPortalDelegate.getActiveTextBufferURI(), 'some-buffer')
  })

  suite.skip('leaving, closing, or losing connection to a portal', () => {
    let hostPortal, hostEditor
    let guest1Portal, guest1PortalDelegate, guest1Editor
    let guest2Portal, guest2PortalDelegate, guest2Editor
    let guest3Portal, guest3PortalDelegate, guest3Editor

    setup(async () => {
      const host = await buildClient()
      hostPortal = await host.createPortal()

      const guest1 = await buildClient()
      guest1PortalDelegate = new FakePortalDelegate()
      guest1Portal = await guest1.joinPortal(hostPortal.id)
      guest1Portal.setDelegate(guest1PortalDelegate)

      const guest2 = await buildClient()
      guest2PortalDelegate = new FakePortalDelegate()
      guest2Portal = await guest2.joinPortal(hostPortal.id)
      guest2Portal.setDelegate(guest2PortalDelegate)

      const guest3 = await buildClient()
      guest3PortalDelegate = new FakePortalDelegate()
      guest3Portal = await guest3.joinPortal(hostPortal.id)
      guest3Portal.setDelegate(guest3PortalDelegate)

      const hostClientBuffer = await hostPortal.createTextBuffer({uri: 'some-buffer', text: ''})
      hostEditor = new Editor()
      const hostClientEditor = await hostPortal.createTextEditor({textBuffer: hostClientBuffer, selectionRanges: {}})
      hostClientEditor.setDelegate(hostEditor)
      await hostPortal.setActiveTextEditor(hostClientEditor)
      await condition(() =>
        guest1PortalDelegate.getActiveTextEditor() != null &&
        guest2PortalDelegate.getActiveTextEditor() != null &&
        guest3PortalDelegate.getActiveTextEditor() != null
      )

      const guest1ClientEditor = guest1PortalDelegate.getActiveTextEditor()
      guest1Editor = new Editor()
      guest1ClientEditor.setDelegate(guest1Editor)
      guest1ClientEditor.setSelectionRanges({1: {start: {row: 0, column: 0}, end: {row: 0, column: 0}}})

      const guest2ClientEditor = guest2PortalDelegate.getActiveTextEditor()
      guest2Editor = new Editor()
      guest2ClientEditor.setDelegate(guest2Editor)
      guest2ClientEditor.setSelectionRanges({1: {start: {row: 0, column: 0}, end: {row: 0, column: 0}}})

      const guest3ClientEditor = guest3PortalDelegate.getActiveTextEditor()
      guest3Editor = new Editor()
      guest3ClientEditor.setDelegate(guest3Editor)
      guest3ClientEditor.setSelectionRanges({1: {start: {row: 0, column: 0}, end: {row: 0, column: 0}}})

      await condition(() =>
        hostEditor.markerLayerForSiteId(guest1Portal.siteId) != null &&
        hostEditor.markerLayerForSiteId(guest2Portal.siteId) != null &&
        hostEditor.markerLayerForSiteId(guest3Portal.siteId) != null
      )
    })

    test('guest leaving a portal', async () => {
      guest1Portal.dispose()
      await condition(() =>
        hostEditor.markerLayerForSiteId(guest1Portal.siteId) == null &&
        guest2Editor.markerLayerForSiteId(guest1Portal.siteId) == null &&
        guest3Editor.markerLayerForSiteId(guest1Portal.siteId) == null
      )
      assert(hostEditor.markerLayerForSiteId(guest2Portal.siteId))
      assert(hostEditor.markerLayerForSiteId(guest3Portal.siteId))
    })

    test('host closing a portal', async () => {
      assert(!guest1PortalDelegate.hasHostClosedPortal() && !guest2PortalDelegate.hasHostClosedPortal() && !guest3PortalDelegate.hasHostClosedPortal())
      hostPortal.dispose()
      await condition(() => guest1PortalDelegate.hasHostClosedPortal() && guest2PortalDelegate.hasHostClosedPortal() && guest3PortalDelegate.hasHostClosedPortal())

      assert(!guest1Editor.markerLayerForSiteId(hostPortal.siteId))
      assert(!guest1Editor.markerLayerForSiteId(guest2Portal.siteId))
      assert(!guest1Editor.markerLayerForSiteId(guest3Portal.siteId))

      assert(!guest2Editor.markerLayerForSiteId(hostPortal.siteId))
      assert(!guest2Editor.markerLayerForSiteId(guest1Portal.siteId))
      assert(!guest2Editor.markerLayerForSiteId(guest3Portal.siteId))

      assert(!guest3Editor.markerLayerForSiteId(hostPortal.siteId))
      assert(!guest3Editor.markerLayerForSiteId(guest1Portal.siteId))
      assert(!guest3Editor.markerLayerForSiteId(guest2Portal.siteId))
    })

    test('losing connection to guest', async () => {
      guest1Portal.simulateNetworkFailure()
      await condition(() =>
        hostEditor.markerLayerForSiteId(guest1Portal.siteId) == null &&
        guest2Editor.markerLayerForSiteId(guest1Portal.siteId) == null &&
        guest3Editor.markerLayerForSiteId(guest1Portal.siteId) == null
      )
      assert(hostEditor.markerLayerForSiteId(guest2Portal.siteId))
      assert(hostEditor.markerLayerForSiteId(guest3Portal.siteId))
    })

    test('losing connection to host', async () => {
      hostPortal.simulateNetworkFailure()
      await condition(() => guest1PortalDelegate.hasHostLostConnection() && guest2PortalDelegate.hasHostLostConnection() && guest3PortalDelegate.hasHostLostConnection())

      assert(!guest1Editor.markerLayerForSiteId(hostPortal.siteId))
      assert(!guest1Editor.markerLayerForSiteId(guest2Portal.siteId))
      assert(!guest1Editor.markerLayerForSiteId(guest3Portal.siteId))

      assert(!guest2Editor.markerLayerForSiteId(hostPortal.siteId))
      assert(!guest2Editor.markerLayerForSiteId(guest1Portal.siteId))
      assert(!guest2Editor.markerLayerForSiteId(guest3Portal.siteId))

      assert(!guest3Editor.markerLayerForSiteId(hostPortal.siteId))
      assert(!guest3Editor.markerLayerForSiteId(guest1Portal.siteId))
      assert(!guest3Editor.markerLayerForSiteId(guest2Portal.siteId))
    })
  })

  async function buildClient () {
    const client = new RealTimeClient({
      restGateway: server.restGateway,
      pubSubGateway: server.pubSubGateway || new PusherPubSubGateway(server.pusherCredentials),
      didCreateOrJoinPortal: (portal) => portals.push(portal),
      testEpoch
    })
    await client.initialize()
    return client
  }

  function condition (fn, message) {
    assert(!conditionErrorMessage, 'Cannot await on multiple conditions at the same time')

    conditionErrorMessage = message
    return new Promise((resolve) => {
      async function callback () {
        const resultOrPromise = fn()
        const result = (resultOrPromise instanceof Promise) ? (await resultOrPromise) : resultOrPromise
        if (result) {
          conditionErrorMessage = null
          resolve()
        } else {
          setTimeout(callback, 5)
        }
      }

      callback()
    })
  }
})
