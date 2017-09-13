require('./setup')
const assert = require('assert')
const deepEqual = require('deep-equal')
const FakeBufferDelegate = require('./helpers/fake-buffer-delegate')
const FakeEditorDelegate = require('./helpers/fake-editor-delegate')
const FakePortalDelegate = require('./helpers/fake-portal-delegate')
const condition = require('./helpers/condition')
const getExampleMediaStream = require('./helpers/get-example-media-stream')
const RealTimeClient = require('../lib/real-time-client')
const PusherPubSubGateway = require('../lib/pusher-pub-sub-gateway')
const {startTestServer} = require('@atom/real-time-server')

let testEpoch = 0

suite('Client Integration', () => {
  let server, portals

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
    portals = []
    return server.reset()
  })

  teardown(async () => {
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
    const hostBufferProxy = await hostPortal.createBufferProxy({uri: 'uri-1', text: hostBufferDelegate.text})
    hostBufferProxy.setDelegate(hostBufferDelegate)
    hostBufferProxy.setTextInRange(...hostBufferDelegate.insert({row: 0, column: 11}, '!'))
    assert.equal(hostSetTextCallCount, 0)

    const hostEditorProxy = await hostPortal.createEditorProxy({
      bufferProxy: hostBufferProxy,
      selections: {
        1: {range: {start: {row: 0, column: 0}, end: {row: 0, column: 5}}},
        2: {range: {start: {row: 0, column: 6}, end: {row: 0, column: 11}}}
      }
    })
    const hostEditorDelegate = new FakeEditorDelegate()
    hostEditorProxy.setDelegate(hostEditorDelegate)
    assert(!hostEditorDelegate.getSelectionsForSiteId(1))
    await hostPortal.setActiveEditorProxy(hostEditorProxy)

    const guestPortalDelegate = new FakePortalDelegate()
    const guestPortal = await guest.joinPortal(hostPortal.id)
    guestPortal.setDelegate(guestPortalDelegate)

    const guestEditorProxy = guestPortalDelegate.getActiveEditorProxy()
    const guestEditorDelegate = new FakeEditorDelegate()
    guestEditorProxy.setDelegate(guestEditorDelegate)

    const guestBufferProxy = guestEditorProxy.bufferProxy
    const guestBufferDelegate = new FakeBufferDelegate()
    guestBufferProxy.setDelegate(guestBufferDelegate)

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
    assert.equal(guestBufferProxy.uri, 'uri-1')
    assert.equal(guestBufferDelegate.getText(), 'hello world!')
    hostBufferProxy.setTextInRange(...hostBufferDelegate.insert({row: 0, column: 5}, ' cruel'))
    guestBufferProxy.setTextInRange(...guestBufferDelegate.delete({row: 0, column: 0}, {row: 0, column: 5}))
    guestBufferProxy.setTextInRange(...guestBufferDelegate.insert({row: 0, column: 0}, 'goodbye'))

    await condition(() => hostBufferDelegate.text === 'goodbye cruel world!')
    await condition(() => guestBufferDelegate.text === 'goodbye cruel world!')

    hostEditorProxy.updateSelections({
      1: {
        range: {start: {row: 0, column: 6}, end: {row: 0, column: 11}}
      },
      2: null
    })
    guestEditorProxy.updateSelections({
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

  test('switching a portal\'s active editor proxy', async () => {
    const host = await buildClient()
    const guest = await buildClient()

    const hostPortal = await host.createPortal()
    const hostBufferProxy1 = await hostPortal.createBufferProxy({uri: 'buffer-a', text: ''})
    const hostEditorProxy1 = await hostPortal.createEditorProxy({bufferProxy: hostBufferProxy1, selectionRanges: {}})
    hostPortal.setActiveEditorProxy(hostEditorProxy1)

    const guestPortalDelegate = new FakePortalDelegate()
    const guestPortal = await guest.joinPortal(hostPortal.id)
    guestPortal.setDelegate(guestPortalDelegate)
    assert.equal(guestPortalDelegate.getActiveBufferProxyURI(), 'buffer-a')
    const guestEditorDelegate1 = guestPortalDelegate.getActiveEditorProxy()

    const hostBufferProxy2 = await hostPortal.createBufferProxy({uri: 'buffer-b', text: ''})
    const hostEditorProxy2 = await hostPortal.createEditorProxy({bufferProxy: hostBufferProxy2, selectionRanges: {}})
    hostPortal.setActiveEditorProxy(hostEditorProxy2)
    await condition(() => guestPortalDelegate.getActiveBufferProxyURI() === 'buffer-b')
    const guestEditorDelegate2 = guestPortalDelegate.getActiveEditorProxy()

    hostPortal.setActiveEditorProxy(hostEditorProxy1)
    await condition(() => guestPortalDelegate.getActiveBufferProxyURI() === 'buffer-a')
    assert.equal(guestPortalDelegate.getActiveEditorProxy(), guestEditorDelegate1)
  })

  test('closing a portal\'s active editor proxy', async () => {
    const host = await buildClient()
    const guest = await buildClient()

    const hostPortal = await host.createPortal()
    const hostBufferProxy = await hostPortal.createBufferProxy({uri: 'some-buffer', text: ''})
    const hostEditorProxy = await hostPortal.createEditorProxy({bufferProxy: hostBufferProxy, selectionRanges: {}})

    const guestPortalDelegate = new FakePortalDelegate()
    const guestPortal = await guest.joinPortal(hostPortal.id)
    guestPortal.setDelegate(guestPortalDelegate)
    assert(guestPortalDelegate.getActiveEditorProxy() === null)

    await hostPortal.setActiveEditorProxy(hostEditorProxy)
    await condition(() => guestPortalDelegate.getActiveEditorProxy() != null)
    assert.equal(guestPortalDelegate.getActiveBufferProxyURI(), 'some-buffer')

    await hostPortal.setActiveEditorProxy(null)
    await condition(() => guestPortalDelegate.getActiveEditorProxy() == null)

    await hostPortal.setActiveEditorProxy(hostEditorProxy)
    await condition(() => guestPortalDelegate.getActiveEditorProxy() != null)
    assert.equal(guestPortalDelegate.getActiveBufferProxyURI(), 'some-buffer')
  })

  test('disposing editor and buffer proxies', async () => {
    const host = await buildClient()
    const guest = await buildClient()

    const hostPortal = await host.createPortal()
    const hostBufferProxy = await hostPortal.createBufferProxy({uri: 'some-buffer', text: ''})
    hostBufferProxy.setDelegate(new FakeBufferDelegate())
    const hostEditorProxy1 = await hostPortal.createEditorProxy({bufferProxy: hostBufferProxy, selectionRanges: {}})
    hostEditorProxy1.setDelegate(new FakeEditorDelegate())
    const hostEditorProxy2 = await hostPortal.createEditorProxy({bufferProxy: hostBufferProxy, selectionRanges: {}})
    hostEditorProxy2.setDelegate(new FakeEditorDelegate())

    await hostPortal.setActiveEditorProxy(hostEditorProxy1)

    const guestPortal = await guest.joinPortal(hostPortal.id)
    const guestPortalDelegate = new FakePortalDelegate()
    guestPortal.setDelegate(guestPortalDelegate)
    await condition(() => guestPortalDelegate.getActiveEditorProxy() != null)
    const guestEditorProxy1 = guestPortalDelegate.getActiveEditorProxy()
    guestEditorProxy1.setDelegate(new FakeEditorDelegate())

    hostPortal.setActiveEditorProxy(hostEditorProxy2)
    await condition(() => guestPortalDelegate.getActiveEditorProxy() !== guestEditorProxy1)
    const guestEditorProxy2 = guestPortalDelegate.getActiveEditorProxy()
    guestEditorProxy2.setDelegate(new FakeEditorDelegate())

    assert.equal(guestEditorProxy1.bufferProxy, guestEditorProxy2.bufferProxy)
    const guestBufferProxy = guestEditorProxy1.bufferProxy
    guestBufferProxy.setDelegate(new FakeBufferDelegate())

    hostEditorProxy1.dispose()
    assert(hostEditorProxy1.delegate.isDisposed())
    await condition(() => guestEditorProxy1.delegate.isDisposed())

    hostEditorProxy2.dispose()
    assert(hostEditorProxy2.delegate.isDisposed())
    await condition(() => guestEditorProxy2.delegate.isDisposed())

    assert(!hostBufferProxy.delegate.isDisposed())
    hostBufferProxy.dispose()
    assert(hostBufferProxy.delegate.isDisposed())
    await condition(() => guestBufferProxy.delegate.isDisposed())
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
      const hostBufferProxy = await hostPortal.createBufferProxy({uri: 'some-buffer', text: hostBufferDelegate.text})
      hostBufferProxy.setDelegate(hostBufferDelegate)

      const hostEditorProxy = await hostPortal.createEditorProxy({bufferProxy: hostBufferProxy, selections: {}})
      hostEditorDelegate = new FakeEditorDelegate()
      hostEditorProxy.setDelegate(hostEditorDelegate)
      await hostPortal.setActiveEditorProxy(hostEditorProxy)

      await condition(() =>
        guest1PortalDelegate.getActiveEditorProxy() != null &&
        guest2PortalDelegate.getActiveEditorProxy() != null &&
        guest3PortalDelegate.getActiveEditorProxy() != null
      )

      const guest1EditorProxy = guest1PortalDelegate.getActiveEditorProxy()
      const guest1BufferProxy = guest1EditorProxy.bufferProxy
      const guest1BufferDelegate = new FakeBufferDelegate()
      guest1BufferProxy.setDelegate(guest1BufferDelegate)
      guest1EditorDelegate = new FakeEditorDelegate()
      guest1EditorProxy.setDelegate(guest1EditorDelegate)
      guest1EditorProxy.updateSelections(
        {1: {range: {start: {row: 0, column: 0}, end: {row: 0, column: 0}}}}
      )

      const guest2EditorProxy = guest2PortalDelegate.getActiveEditorProxy()
      const guest2BufferProxy = guest2EditorProxy.bufferProxy
      const guest2BufferDelegate = new FakeBufferDelegate()
      guest2BufferProxy.setDelegate(guest2BufferDelegate)
      guest2EditorDelegate = new FakeEditorDelegate()
      guest2EditorProxy.setDelegate(guest2EditorDelegate)
      guest2EditorProxy.updateSelections(
        {1: {range: {start: {row: 0, column: 0}, end: {row: 0, column: 0}}}}
      )

      const guest3EditorProxy = guest3PortalDelegate.getActiveEditorProxy()
      const guest3BufferProxy = guest3EditorProxy.bufferProxy
      const guest3BufferDelegate = new FakeBufferDelegate()
      guest3BufferProxy.setDelegate(guest3BufferDelegate)
      guest3EditorDelegate = new FakeEditorDelegate()
      guest3EditorProxy.setDelegate(guest3EditorDelegate)
      guest3EditorProxy.updateSelections(
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
})
