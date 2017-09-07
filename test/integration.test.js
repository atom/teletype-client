require('./setup')
const assert = require('assert')
const deepEqual = require('deep-equal')
const FakeBufferDelegate = require('./helpers/fake-buffer-delegate')
const FakeEditorDelegate = require('./helpers/fake-editor-delegate')
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
    const hostBufferDelegate = new FakeBufferDelegate('hello world', {didSetText: () => hostSetTextCallCount++})
    const hostClientBuffer = await hostPortal.createTextBuffer({uri: 'uri-1', text: hostBufferDelegate.text})
    hostClientBuffer.setDelegate(hostBufferDelegate)
    hostClientBuffer.setTextInRange(...hostBufferDelegate.insert({row: 0, column: 11}, '!'))
    assert.equal(hostSetTextCallCount, 0)

    const hostClientEditor = await hostPortal.createTextEditor({
      textBuffer: hostClientBuffer,
      selections: {
        1: {range: {start: {row: 0, column: 0}, end: {row: 0, column: 5}}},
        2: {range: {start: {row: 0, column: 6}, end: {row: 0, column: 11}}}
      }
    })
    const hostEditorDelegate = new FakeEditorDelegate()
    hostClientEditor.setDelegate(hostEditorDelegate)
    assert(!hostEditorDelegate.getSelectionsForSiteId(1))
    await hostPortal.setActiveTextEditor(hostClientEditor)

    const guestPortalDelegate = new FakePortalDelegate()
    const guestPortal = await guest.joinPortal(hostPortal.id)
    guestPortal.setDelegate(guestPortalDelegate)

    const guestClientEditor = guestPortalDelegate.getActiveTextEditor()
    const guestEditorDelegate = new FakeEditorDelegate()
    guestClientEditor.setDelegate(guestEditorDelegate)

    const guestClientBuffer = guestClientEditor.textBuffer
    const guestBufferDelegate = new FakeBufferDelegate()
    guestClientBuffer.setDelegate(guestBufferDelegate)

    assert.deepEqual(guestEditorDelegate.getSelectionsForSiteId(1), {
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
    assert.equal(guestBufferDelegate.getText(), 'hello world!')
    hostClientBuffer.setTextInRange(...hostBufferDelegate.insert({row: 0, column: 5}, ' cruel'))
    guestClientBuffer.setTextInRange(...guestBufferDelegate.delete({row: 0, column: 0}, {row: 0, column: 5}))
    guestClientBuffer.setTextInRange(...guestBufferDelegate.insert({row: 0, column: 0}, 'goodbye'))

    await condition(() => hostBufferDelegate.text === 'goodbye cruel world!')
    await condition(() => guestBufferDelegate.text === 'goodbye cruel world!')

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
        deepEqual(guestEditorDelegate.getSelectionsForSiteId(1), expectedHostSelectionsOnGuest) &&
        deepEqual(hostEditorDelegate.getSelectionsForSiteId(2), expectedGuestSelectionsOnHost)
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
    const guestEditorDelegate1 = guestPortalDelegate.getActiveTextEditor()

    const hostBuffer2 = await hostPortal.createTextBuffer({uri: 'buffer-b', text: ''})
    const hostEditor2 = await hostPortal.createTextEditor({textBuffer: hostBuffer2, selectionRanges: {}})
    hostPortal.setActiveTextEditor(hostEditor2)
    await condition(() => guestPortalDelegate.getActiveTextBufferURI() === 'buffer-b')
    const guestEditorDelegate2 = guestPortalDelegate.getActiveTextEditor()

    hostPortal.setActiveTextEditor(hostEditor1)
    await condition(() => guestPortalDelegate.getActiveTextBufferURI() === 'buffer-a')
    assert.equal(guestPortalDelegate.getActiveTextEditor(), guestEditorDelegate1)
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

  suite('leaving, closing, or losing connection to a portal', () => {
    let hostPortal, hostEditorDelegate
    let guest1Portal, guest1PortalDelegate, guest1EditorDelegate
    let guest2Portal, guest2PortalDelegate, guest2EditorDelegate
    let guest3Portal, guest3PortalDelegate, guest3EditorDelegate

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

      const hostBufferDelegate = new FakeBufferDelegate('')
      const hostClientBuffer = await hostPortal.createTextBuffer({uri: 'some-buffer', text: hostBufferDelegate.text})
      hostClientBuffer.setDelegate(hostBufferDelegate)

      const hostClientEditor = await hostPortal.createTextEditor({textBuffer: hostClientBuffer, selections: {}})
      hostEditorDelegate = new FakeEditorDelegate()
      hostClientEditor.setDelegate(hostEditorDelegate)
      await hostPortal.setActiveTextEditor(hostClientEditor)

      await condition(() =>
        guest1PortalDelegate.getActiveTextEditor() != null &&
        guest2PortalDelegate.getActiveTextEditor() != null &&
        guest3PortalDelegate.getActiveTextEditor() != null
      )

      const guest1ClientEditor = guest1PortalDelegate.getActiveTextEditor()
      const guest1ClientBuffer = guest1ClientEditor.textBuffer
      const guest1BufferDelegate = new FakeBufferDelegate()
      guest1ClientBuffer.setDelegate(guest1BufferDelegate)
      guest1EditorDelegate = new FakeEditorDelegate()
      guest1ClientEditor.setDelegate(guest1EditorDelegate)
      guest1ClientEditor.updateSelections(
        {1: {range: {start: {row: 0, column: 0}, end: {row: 0, column: 0}}}}
      )

      const guest2ClientEditor = guest2PortalDelegate.getActiveTextEditor()
      const guest2ClientBuffer = guest2ClientEditor.textBuffer
      const guest2BufferDelegate = new FakeBufferDelegate()
      guest2ClientBuffer.setDelegate(guest2BufferDelegate)
      guest2EditorDelegate = new FakeEditorDelegate()
      guest2ClientEditor.setDelegate(guest2EditorDelegate)
      guest2ClientEditor.updateSelections(
        {1: {range: {start: {row: 0, column: 0}, end: {row: 0, column: 0}}}}
      )

      const guest3ClientEditor = guest3PortalDelegate.getActiveTextEditor()
      const guest3ClientBuffer = guest3ClientEditor.textBuffer
      const guest3BufferDelegate = new FakeBufferDelegate()
      guest3ClientBuffer.setDelegate(guest3BufferDelegate)
      guest3EditorDelegate = new FakeEditorDelegate()
      guest3ClientEditor.setDelegate(guest3EditorDelegate)
      guest3ClientEditor.updateSelections(
        {1: {range: {start: {row: 0, column: 0}, end: {row: 0, column: 0}}}}
      )

      await condition(() =>
        hostEditorDelegate.getSelectionsForSiteId(guest1Portal.siteId) != null &&
        hostEditorDelegate.getSelectionsForSiteId(guest2Portal.siteId) != null &&
        hostEditorDelegate.getSelectionsForSiteId(guest3Portal.siteId) != null
      )
    })

    test('guest leaving a portal', async () => {
      guest1Portal.dispose()
      await condition(() =>
        hostEditorDelegate.getSelectionsForSiteId(guest1Portal.siteId) == null &&
        guest2EditorDelegate.getSelectionsForSiteId(guest1Portal.siteId) == null &&
        guest3EditorDelegate.getSelectionsForSiteId(guest1Portal.siteId) == null
      )
      assert(hostEditorDelegate.getSelectionsForSiteId(guest2Portal.siteId))
      assert(hostEditorDelegate.getSelectionsForSiteId(guest3Portal.siteId))
    })

    test('host closing a portal', async () => {
      assert(!guest1PortalDelegate.hasHostClosedPortal() && !guest2PortalDelegate.hasHostClosedPortal() && !guest3PortalDelegate.hasHostClosedPortal())
      hostPortal.dispose()
      await condition(() => guest1PortalDelegate.hasHostClosedPortal() && guest2PortalDelegate.hasHostClosedPortal() && guest3PortalDelegate.hasHostClosedPortal())

      assert(!guest1EditorDelegate.getSelectionsForSiteId(hostPortal.siteId))
      assert(!guest1EditorDelegate.getSelectionsForSiteId(guest2Portal.siteId))
      assert(!guest1EditorDelegate.getSelectionsForSiteId(guest3Portal.siteId))

      assert(!guest2EditorDelegate.getSelectionsForSiteId(hostPortal.siteId))
      assert(!guest2EditorDelegate.getSelectionsForSiteId(guest1Portal.siteId))
      assert(!guest2EditorDelegate.getSelectionsForSiteId(guest3Portal.siteId))

      assert(!guest3EditorDelegate.getSelectionsForSiteId(hostPortal.siteId))
      assert(!guest3EditorDelegate.getSelectionsForSiteId(guest1Portal.siteId))
      assert(!guest3EditorDelegate.getSelectionsForSiteId(guest2Portal.siteId))
    })

    test('losing connection to guest', async () => {
      guest1Portal.simulateNetworkFailure()
      await condition(() =>
        hostEditorDelegate.getSelectionsForSiteId(guest1Portal.siteId) == null &&
        guest2EditorDelegate.getSelectionsForSiteId(guest1Portal.siteId) == null &&
        guest3EditorDelegate.getSelectionsForSiteId(guest1Portal.siteId) == null
      )
      assert(hostEditorDelegate.getSelectionsForSiteId(guest2Portal.siteId))
      assert(hostEditorDelegate.getSelectionsForSiteId(guest3Portal.siteId))
    })

    test('losing connection to host', async () => {
      hostPortal.simulateNetworkFailure()
      await condition(() => guest1PortalDelegate.hasHostLostConnection() && guest2PortalDelegate.hasHostLostConnection() && guest3PortalDelegate.hasHostLostConnection())

      assert(!guest1EditorDelegate.getSelectionsForSiteId(hostPortal.siteId))
      assert(!guest1EditorDelegate.getSelectionsForSiteId(guest2Portal.siteId))
      assert(!guest1EditorDelegate.getSelectionsForSiteId(guest3Portal.siteId))

      assert(!guest2EditorDelegate.getSelectionsForSiteId(hostPortal.siteId))
      assert(!guest2EditorDelegate.getSelectionsForSiteId(guest1Portal.siteId))
      assert(!guest2EditorDelegate.getSelectionsForSiteId(guest3Portal.siteId))

      assert(!guest3EditorDelegate.getSelectionsForSiteId(hostPortal.siteId))
      assert(!guest3EditorDelegate.getSelectionsForSiteId(guest1Portal.siteId))
      assert(!guest3EditorDelegate.getSelectionsForSiteId(guest2Portal.siteId))
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
