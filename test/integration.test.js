require('./setup')
const assert = require('assert')
const deepEqual = require('deep-equal')
const FakeBufferDelegate = require('./helpers/fake-buffer-delegate')
const FakeEditorDelegate = require('./helpers/fake-editor-delegate')
const FakePortalDelegate = require('./helpers/fake-portal-delegate')
const condition = require('./helpers/condition')
const timeout = require('./helpers/timeout')
const {TeletypeClient, FollowState, Errors} = require('..')
const RestGateway = require('../lib/rest-gateway')
const PusherPubSubGateway = require('../lib/pusher-pub-sub-gateway')
const {startTestServer} = require('@atom/teletype-server')

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
      portal.dispose()
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
    hostPortal.activateEditorProxy(hostEditorProxy)

    const guestPortalDelegate = new FakePortalDelegate()
    const guestPortal = await guest.joinPortal(hostPortal.id)
    await guestPortal.setDelegate(guestPortalDelegate)

    const guestEditorProxy = guestPortalDelegate.getTetherEditorProxy()
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

  test('adding and removing editor proxies', async () => {
    const host = await buildClient()
    const hostPortal = await host.createPortal()

    const guest1 = await buildClient()
    const guest1Portal = await guest1.joinPortal(hostPortal.id)
    const guest1PortalDelegate = new FakePortalDelegate()
    guest1Portal.setDelegate(guest1PortalDelegate)
    assert.equal(guest1Portal.getEditorProxiesMetadata().length, 0)

    const hostBufferProxy1 = await hostPortal.createBufferProxy({uri: 'buffer-a', text: ''})
    const hostEditorProxy1 = await hostPortal.createEditorProxy({bufferProxy: hostBufferProxy1})
    await condition(() => guest1Portal.getEditorProxiesMetadata().length === 1)
    assert.equal(guest1PortalDelegate.editorProxiesChangeEventCount, 1)

    const hostBufferProxy2 = await hostPortal.createBufferProxy({uri: 'buffer-b', text: ''})
    const hostEditorProxy2 = await hostPortal.createEditorProxy({bufferProxy: hostBufferProxy2})
    hostPortal.activateEditorProxy(hostEditorProxy2)
    await condition(() => guest1Portal.getEditorProxiesMetadata().length === 2)
    assert.equal(guest1PortalDelegate.editorProxiesChangeEventCount, 2)

    const guest2 = await buildClient()
    const guest2Portal = await guest2.joinPortal(hostPortal.id)
    const guest2PortalDelegate = new FakePortalDelegate()
    guest2Portal.setDelegate(guest2PortalDelegate)
    assert.equal(guest2Portal.getEditorProxiesMetadata().length, 2)
    assert.equal(guest2PortalDelegate.editorProxiesChangeEventCount, 0)

    hostEditorProxy1.dispose()
    await condition(() => (
      guest1Portal.getEditorProxiesMetadata().length === 1 &&
      guest2Portal.getEditorProxiesMetadata().length === 1
    ))
    assert.equal(guest1PortalDelegate.editorProxiesChangeEventCount, 3)
    assert.equal(guest2PortalDelegate.editorProxiesChangeEventCount, 1)

    hostEditorProxy2.dispose()
    hostPortal.activateEditorProxy(null)
    await condition(() => (
      guest1Portal.getEditorProxiesMetadata().length === 0 &&
      guest2Portal.getEditorProxiesMetadata().length === 0
    ))
    assert.equal(guest1PortalDelegate.editorProxiesChangeEventCount, 4)
    assert.equal(guest2PortalDelegate.editorProxiesChangeEventCount, 2)

    const hostBufferProxy3 = await hostPortal.createBufferProxy({uri: 'buffer-c', text: ''})
    const hostEditorProxy3 = await hostPortal.createEditorProxy({bufferProxy: hostBufferProxy3})
    await condition(() => (
      guest1Portal.getEditorProxiesMetadata().length === 1 &&
      guest2Portal.getEditorProxiesMetadata().length === 1
    ))
    assert.equal(guest1PortalDelegate.editorProxiesChangeEventCount, 5)
    assert.equal(guest2PortalDelegate.editorProxiesChangeEventCount, 3)

    const guest3 = await buildClient()
    const guest3Portal = await guest3.joinPortal(hostPortal.id)
    assert.equal(guest3Portal.getEditorProxiesMetadata().length, 1)
  })

  suite('tethering to other participants', () => {
    test('extending, retracting, and disconnecting when collaborating across multiple editors', async () => {
      const host = await buildClient()
      const guest1 = await buildClient()

      const hostPortal = await host.createPortal()
      const hostPortalDelegate = new FakePortalDelegate()
      hostPortal.setDelegate(hostPortalDelegate)

      const hostBufferProxy1 = await hostPortal.createBufferProxy({uri: 'buffer-1', text: ('x'.repeat(30) + '\n').repeat(30)})
      const hostEditorProxy1 = await hostPortal.createEditorProxy({bufferProxy: hostBufferProxy1})
      hostPortal.activateEditorProxy(hostEditorProxy1)

      const guest1PortalDelegate = new FakePortalDelegate()
      const guest1Portal = await guest1.joinPortal(hostPortal.id)
      await guest1Portal.setDelegate(guest1PortalDelegate)
      assert.equal(guest1Portal.resolveFollowState(), FollowState.RETRACTED)

      // Extend the tether when the follower performs an action
      const guest1EditorProxy1 = guest1PortalDelegate.getTetherEditorProxy()
      guest1EditorProxy1.bufferProxy.setTextInRange({row: 1, column: 1}, {row: 1, column: 1}, 'X')
      await condition(() => guest1Portal.resolveFollowState() === FollowState.EXTENDED)

      // Retract an extended tether if leader moves to a different editor and
      // the tether disconnect window has elapsed since the last action taken by
      // by the follower
      await timeout(guest1Portal.tetherDisconnectWindow)
      const hostBufferProxy2 = await hostPortal.createBufferProxy({uri: 'buffer-2', text: ('y'.repeat(30) + '\n').repeat(30)})
      const hostEditorProxy2 = await hostPortal.createEditorProxy({bufferProxy: hostBufferProxy2})
      hostPortal.activateEditorProxy(hostEditorProxy2)
      await condition(() => (
        guest1Portal.resolveFollowState() === FollowState.RETRACTED &&
        guest1PortalDelegate.getTetherBufferProxyURI() === 'buffer-2'
      ))

      // Disconnect an extended tether if leader moves to a different editor
      // within the disconnect window.
      const guest1EditorProxy2 = guest1PortalDelegate.getTetherEditorProxy()
      guest1EditorProxy2.updateSelections({
        1: {range: range([2, 1], [2, 1])}
      }, {initialUpdate: true})

      guest1EditorProxy2.bufferProxy.setTextInRange({row: 1, column: 1}, {row: 1, column: 1}, 'X')
      await condition(() => guest1Portal.resolveFollowState() === FollowState.EXTENDED)
      hostPortal.activateEditorProxy(hostEditorProxy1)
      await condition(() => (
        guest1Portal.resolveFollowState() === FollowState.DISCONNECTED &&
        guest1PortalDelegate.getTetherBufferProxyURI() === 'buffer-2'
      ))

      // New guests can start following existing participants.
      const guest2 = await buildClient()
      const guest2PortalDelegate = new FakePortalDelegate()
      const guest2Portal = await guest2.joinPortal(hostPortal.id)
      await guest2Portal.setDelegate(guest2PortalDelegate)

      guest2Portal.follow(guest1Portal.siteId)

      assert.equal(guest2PortalDelegate.getTetherBufferProxyURI(), 'buffer-2')
      assert.deepEqual(guest2PortalDelegate.getTetherPosition(), {row: 2, column: 1})

      // When you start to follow a participant, you go to their position in
      // their active editor
      hostPortal.follow(guest1Portal.siteId)
      guest1EditorProxy2.updateSelections({
        2: {range: {start: {row: 4, column: 4}, end: {row: 4, column: 4}}}
      })
      await condition(() => (
        hostPortalDelegate.getTetherBufferProxyURI() === 'buffer-2' &&
        deepEqual(hostPortalDelegate.getTetherPosition(), {row: 4, column: 4})
      ))
    })

    test('extending, retracting, and disconnecting when collaborating in a single editor', async () => {
      const host = await buildClient()
      const guest = await buildClient()

      const hostPortal = await host.createPortal()
      const hostBufferProxy = await hostPortal.createBufferProxy({uri: 'buffer-a', text: ('x'.repeat(30) + '\n').repeat(30)})
      const hostEditorProxy = await hostPortal.createEditorProxy({bufferProxy: hostBufferProxy,
        selections: {
          1: {range: {start: {row: 5, column: 5}, end: {row: 6, column: 6}}},
          2: {range: {start: {row: 8, column: 8}, end: {row: 9, column: 9}}}
        }
      })
      hostPortal.activateEditorProxy(hostEditorProxy)

      const guestPortalDelegate = new FakePortalDelegate()
      const guestPortal = await guest.joinPortal(hostPortal.id)
      await guestPortal.setDelegate(guestPortalDelegate)

      // Guests immediately jump to host's cursor position after joining.
      assert.equal(guestPortal.resolveFollowState(), FollowState.RETRACTED)
      assert.deepEqual(guestPortalDelegate.getTetherPosition(), {row: 9, column: 9})

      const guestEditorProxy = guestPortalDelegate.getTetherEditorProxy()
      const guestEditorDelegate = new FakeEditorDelegate()
      guestEditorDelegate.updateViewport(5, 15)
      guestEditorProxy.setDelegate(guestEditorDelegate)

      // Guests continue to follow host's cursor as it moves.
      hostEditorProxy.updateSelections({
        2: {range: {start: {row: 10, column: 10}, end: {row: 11, column: 11}}, reversed: true}
      })
      await condition(() => deepEqual(guestPortalDelegate.getTetherPosition(), {row: 10, column: 10}))

      // Extend the tether when the guest explicitly moves their cursor
      guestEditorProxy.updateSelections({
        2: {range: {start: {row: 9, column: 9}, end: {row: 9, column: 9}}}
      })
      assert.equal(guestPortal.resolveFollowState(), FollowState.EXTENDED)

      // When the tether is extended, the follower's cursor does not follow
      // the tether's position as long as it remains visible in the viewport
      assert(!guestEditorDelegate.isScrollNeededToViewPosition({row: 11, column: 11}))
      hostEditorProxy.updateSelections({
        2: {range: {start: {row: 11, column: 11}, end: {row: 11, column: 11}}}
      })
      await condition(() => deepEqual(
        guestEditorDelegate.getSelectionsForSiteId(1)[2].range,
        {start: {row: 11, column: 11}, end: {row: 11, column: 11}}
      ))
      await condition(() => deepEqual(guestPortalDelegate.getTetherPosition(), {row: 10, column: 10}))

      // Moves out of the viewport will retract the tether so long as the
      // tether disconnect window has elapsed since the last cursor movement
      // by the follower
      await timeout(guestPortal.tetherDisconnectWindow)
      assert(guestEditorDelegate.isScrollNeededToViewPosition({row: 20, column: 20}))
      hostEditorProxy.updateSelections({
        2: {range: {start: {row: 20, column: 20}, end: {row: 20, column: 20}}}
      })
      await condition(() => guestPortalDelegate.getTetherState() === FollowState.RETRACTED)
      assert.deepEqual(guestPortalDelegate.getTetherPosition(), {row: 20, column: 20})

      hostEditorProxy.updateSelections({
        2: {range: {start: {row: 21, column: 21}, end: {row: 21, column: 21}}}
      })
      await condition(() => deepEqual(guestPortalDelegate.getTetherPosition(), {row: 21, column: 21}))

      // Update delegate's tether position when text changes on remote sites.
      hostBufferProxy.setTextInRange({row: 21, column: 0}, {row: 21, column: 0}, 'X')
      await condition(() => deepEqual(guestPortalDelegate.getTetherPosition(), {row: 21, column: 22}))

      // Extend the tether when the follower starts typing.
      guestEditorProxy.bufferProxy.setTextInRange({row: 21, column: 22}, {row: 21, column: 22}, 'ABCD')
      assert.equal(guestPortal.resolveFollowState(), FollowState.EXTENDED)

      // Disconnects the tether if leader moves offscreen within the disconnect window.
      hostEditorProxy.updateSelections({
        2: {range: {start: {row: 0, column: 0}, end: {row: 0, column: 0}}}
      })
      await condition(() => guestPortalDelegate.getTetherState() === FollowState.DISCONNECTED)
      assert.deepEqual(
        guestEditorDelegate.getSelectionsForSiteId(1)[2].range,
        {start: {row: 0, column: 0}, end: {row: 0, column: 0}}
      )

      // Can reconnect tether after disconnecting
      guestPortal.follow(1)
      assert.equal(guestPortalDelegate.getTetherState(), FollowState.RETRACTED)
      assert.deepEqual(guestPortalDelegate.getTetherPosition(), {row: 0, column: 0})
      hostEditorProxy.updateSelections({
        2: {range: {start: {row: 1, column: 1}, end: {row: 1, column: 1}}}
      })
      await condition(() => deepEqual(guestPortalDelegate.getTetherPosition(), {row: 1, column: 1}))

      // Disconnects the tether if it moves off screen within the disconnect
      // window of the follower moving their cursor
      guestEditorProxy.updateSelections({
        2: {range: {start: {row: 22, column: 22}, end: {row: 22, column: 22}}}
      })
      hostEditorProxy.updateSelections({
        2: {range: {start: {row: 0, column: 0}, end: {row: 0, column: 0}}}
      })
      await condition(() => guestPortalDelegate.getTetherState() === FollowState.DISCONNECTED)
      assert.deepEqual(
        guestEditorDelegate.getSelectionsForSiteId(1)[2].range,
        {start: {row: 0, column: 0}, end: {row: 0, column: 0}}
      )

      // Can reconnect tether after disconnecting
      guestPortal.follow(1)
      assert.equal(guestPortalDelegate.getTetherState(), FollowState.RETRACTED)
      assert.deepEqual(guestPortalDelegate.getTetherPosition(), {row: 0, column: 0})
      hostEditorProxy.updateSelections({
        2: {range: {start: {row: 1, column: 1}, end: {row: 1, column: 1}}}
      })
      await condition(() => deepEqual(guestPortalDelegate.getTetherPosition(), {row: 1, column: 1}))

      // Disconnect tether when we scroll out of view. In real life, the
      // viewport would have changed when we reconnected the tether, but in
      // this test we're only concerned with the tether position being out of
      // view when we indicate a scroll.
      assert(guestEditorDelegate.isScrollNeededToViewPosition({row: 1, column: 1}))
      guestEditorProxy.didScroll()
      assert.equal(guestPortalDelegate.getTetherState(), FollowState.DISCONNECTED)
      hostEditorProxy.updateSelections({
        2: {range: {start: {row: 0, column: 0}, end: {row: 0, column: 0}}}
      })
      await condition(() => deepEqual(
        guestEditorDelegate.getSelectionsForSiteId(1)[2].range,
        {start: {row: 0, column: 0}, end: {row: 0, column: 0}}
      ))
      assert.notDeepEqual(guestPortalDelegate.getTetherPosition(), {row: 0, column: 0})
    })

    test('showing and hiding selections', async () => {
      const host = await buildClient()
      const hostPortal = await host.createPortal()
      const hostBufferProxy1 = await hostPortal.createBufferProxy({uri: 'buffer-a', text: ('x'.repeat(30) + '\n').repeat(30)})
      const hostEditorProxy1 = await hostPortal.createEditorProxy({bufferProxy: hostBufferProxy1, selections: {
        1: {range: {start: {row: 5, column: 5}, end: {row: 6, column: 6}}}
      }})
      const hostEditor1Delegate = new FakeEditorDelegate()
      hostEditorProxy1.setDelegate(hostEditor1Delegate)
      hostPortal.activateEditorProxy(hostEditorProxy1)

      const guest = await buildClient()
      const guestPortalDelegate = new FakePortalDelegate()
      const guestPortal = await guest.joinPortal(hostPortal.id)
      await guestPortal.setDelegate(guestPortalDelegate)

      const guestEditor1Proxy = guestPortalDelegate.getTetherEditorProxy()
      const guestEditor1Delegate = new FakeEditorDelegate()
      guestEditor1Proxy.setDelegate(guestEditor1Delegate)
      guestEditor1Proxy.updateSelections({
        1: {range: {start: {row: 0, column: 0}, end: {row: 0, column: 0}}}
      }, {initialUpdate: true})

      assert.deepEqual(guestPortalDelegate.getTetherPosition(), {row: 6, column: 6})

      // Cursors are not rendered locally or remotely for followers with
      // retracted tethers
      await condition(() => deepEqual(hostEditor1Delegate.getSelectionsForSiteId(2), {}))

      // When the tether is extended, selections appear
      guestEditor1Proxy.updateSelections({
        1: {range: {start: {row: 1, column: 1}, end: {row: 1, column: 1}}}
      })
      await condition(() => {
        const selection = hostEditor1Delegate.getSelectionsForSiteId(2)[1]
        return selection && deepEqual(selection.range, {start: {row: 1, column: 1}, end: {row: 1, column: 1}})
      })

      // Selections disappear when the tether is retracted again
      await timeout(guestPortal.tetherDisconnectWindow)
      guestEditor1Delegate.updateViewport(0, 6)
      hostEditorProxy1.updateSelections({
        1: {range: {start: {row: 12, column: 12}, end: {row: 12, column: 12}}}
      })
      await condition(() => deepEqual(guestPortal.resolveLeaderPosition(), {row: 12, column: 12}))
      await condition(() => deepEqual(hostEditor1Delegate.getSelectionsForSiteId(2), {}))

      // Disconnecting the tether shows the selections again
      guestEditor1Delegate.updateViewport(6, 15)
      guestEditor1Proxy.updateSelections({
        1: {range: {start: {row: 13, column: 13}, end: {row: 13, column: 13}}}
      })
      hostEditorProxy1.updateSelections({
        1: {range: {start: {row: 0, column: 0}, end: {row: 0, column: 0}}}
      })
      await condition(() => {
        const selection = hostEditor1Delegate.getSelectionsForSiteId(2)[1]
        return selection && deepEqual(selection.range, {start: {row: 13, column: 13}, end: {row: 13, column: 13}})
      })

      // Activating an editor proxy hides selection on the previously active
      // editor proxy and shows them on the new one.
      const hostBufferProxy2 = await hostPortal.createBufferProxy({uri: 'buffer-b', text: ('x'.repeat(30) + '\n').repeat(30)})
      const hostEditorProxy2 = await hostPortal.createEditorProxy({bufferProxy: hostBufferProxy2, selections: {
        1: {range: {start: {row: 1, column: 3}, end: {row: 2, column: 4}}}
      }})
      const hostEditor2Delegate = new FakeEditorDelegate()
      hostEditorProxy2.setDelegate(hostEditor2Delegate)
      hostPortal.activateEditorProxy(hostEditorProxy2)

      await condition(() => guestPortal.getEditorProxiesMetadata().length === 2)

      const guestEditor2ProxyMetadata = guestPortal.getEditorProxiesMetadata().find((e) => e.bufferProxyURI === 'buffer-b')
      const guestEditor2Proxy = await guestPortal.findOrFetchEditorProxy(guestEditor2ProxyMetadata.id)
      const guestEditor2Delegate = new FakeEditorDelegate()
      guestEditor2Proxy.setDelegate(guestEditor2Delegate)
      guestEditor2Proxy.updateSelections({
        1: {range: {start: {row: 0, column: 0}, end: {row: 0, column: 0}}}
      }, {initialUpdate: true})

      await condition(() => (
        deepEqual(guestEditor1Delegate.getSelectionsForSiteId(1), {}) &&
        !deepEqual(guestEditor2Delegate.getSelectionsForSiteId(1), {})
      ))

      hostPortal.activateEditorProxy(hostEditorProxy1)

      await condition(() => (
        !deepEqual(guestEditor1Delegate.getSelectionsForSiteId(1), {}) &&
        deepEqual(guestEditor2Delegate.getSelectionsForSiteId(1), {})
      ))

      // Retracting the tether when the leader is on a different editor proxy hides follower selections.
      assert.notDeepEqual(hostEditor1Delegate.getSelectionsForSiteId(2), {})
      assert.deepEqual(hostEditor2Delegate.getSelectionsForSiteId(2), {})

      guestPortal.follow(1)

      await condition(() => (
        deepEqual(hostEditor1Delegate.getSelectionsForSiteId(2), {}) &&
        deepEqual(hostEditor2Delegate.getSelectionsForSiteId(2), {})
      ))
    })

    test('transitive tethering (without cycles)', async () => {
      const host = await buildClient()
      const guest1 = await buildClient()
      const guest2 = await buildClient()

      const hostPortal = await host.createPortal()
      const hostBufferProxy1 = await hostPortal.createBufferProxy({uri: 'buffer-a', text: ('x'.repeat(30) + '\n').repeat(30)})
      const hostEditorProxy1 = await hostPortal.createEditorProxy({
        bufferProxy: hostBufferProxy1,
        selections: {1: {range: {start: {row: 5, column: 5}, end: {row: 5, column: 5}}}}
      })
      const hostEditor1Delegate = new FakeEditorDelegate()
      hostEditorProxy1.setDelegate(hostEditor1Delegate)
      hostPortal.activateEditorProxy(hostEditorProxy1)

      const guest1PortalDelegate = new FakePortalDelegate()
      const guest1Portal = await guest1.joinPortal(hostPortal.id)
      await guest1Portal.setDelegate(guest1PortalDelegate)

      const guest1Editor1Proxy = guest1PortalDelegate.getTetherEditorProxy()
      const guest1Editor1Delegate = new FakeEditorDelegate()
      guest1Editor1Delegate.updateViewport(5, 15)
      guest1Editor1Proxy.setDelegate(guest1Editor1Delegate)

      const guest2PortalDelegate = new FakePortalDelegate()
      const guest2Portal = await guest2.joinPortal(hostPortal.id)
      await guest2Portal.setDelegate(guest2PortalDelegate)

      const guest2Editor1Proxy = guest2PortalDelegate.getTetherEditorProxy()
      const guest2Editor1Delegate = new FakeEditorDelegate()
      guest2Editor1Delegate.updateViewport(5, 15)
      guest2Editor1Proxy.setDelegate(guest2Editor1Delegate)

      // Guest1 follows the host, and Guest2 follows Guest1. This has the effect
      // of making Guest2 follow the host.
      guest1Portal.follow(hostPortal.siteId)
      guest2Portal.follow(guest1Portal.siteId)
      hostEditorProxy1.updateSelections({
        1: {range: {start: {row: 12, column: 12}, end: {row: 12, column: 12}}}
      })
      await condition(() => (
        deepEqual(guest1PortalDelegate.getTetherPosition(), {row: 12, column: 12}) &&
        deepEqual(guest2PortalDelegate.getTetherPosition(), {row: 12, column: 12}) &&
        deepEqual(hostEditor1Delegate.getSelectionsForSiteId(2), {}) &&
        deepEqual(hostEditor1Delegate.getSelectionsForSiteId(3), {})
      ))

      // When tether is extended on Guest1, Guest2 momentarily stops following the host.
      guest1Editor1Proxy.updateSelections({
        1: {range: {start: {row: 1, column: 1}, end: {row: 1, column: 1}}}
      })
      await condition(() => {
        const selection = hostEditor1Delegate.getSelectionsForSiteId(2)[1]
        return (
          selection && deepEqual(selection.range, {start: {row: 1, column: 1}, end: {row: 1, column: 1}}) &&
          deepEqual(guest2PortalDelegate.getTetherPosition(), {row: 1, column: 1}) &&
          deepEqual(hostEditor1Delegate.getSelectionsForSiteId(3), {})
        )
      })

      // When tether is retracted on Guest1, Guest2 goes back to following the host.
      await timeout(guest1Portal.tetherDisconnectWindow)
      guest1Editor1Delegate.updateViewport(0, 6)
      hostEditorProxy1.updateSelections({
        1: {range: {start: {row: 8, column: 0}, end: {row: 8, column: 0}}}
      })
      await condition(() => (
        deepEqual(guest1PortalDelegate.getTetherPosition(), {row: 8, column: 0}) &&
        deepEqual(guest2PortalDelegate.getTetherPosition(), {row: 8, column: 0}) &&
        deepEqual(hostEditor1Delegate.getSelectionsForSiteId(2), {}) &&
        deepEqual(hostEditor1Delegate.getSelectionsForSiteId(3), {})
      ))

      // Ensure transitive following works for new sites that join after
      // tethering has already been established.
      const guest3 = await buildClient()
      const guest3PortalDelegate = new FakePortalDelegate()
      const guest3Portal = await guest3.joinPortal(hostPortal.id)
      await guest3Portal.setDelegate(guest3PortalDelegate)

      const guest3EditorProxy = guest3PortalDelegate.getTetherEditorProxy()
      const guest3EditorDelegate = new FakeEditorDelegate()
      guest3EditorDelegate.updateViewport(5, 15)
      guest3EditorProxy.setDelegate(guest3EditorDelegate)

      guest3Portal.follow(guest2Portal.siteId)
      await condition(() => (
        deepEqual(guest1PortalDelegate.getTetherPosition(), {row: 8, column: 0}) &&
        deepEqual(guest2PortalDelegate.getTetherPosition(), {row: 8, column: 0}) &&
        deepEqual(guest3PortalDelegate.getTetherPosition(), {row: 8, column: 0}) &&
        deepEqual(hostEditor1Delegate.getSelectionsForSiteId(guest1Portal.siteId), {}) &&
        deepEqual(hostEditor1Delegate.getSelectionsForSiteId(guest2Portal.siteId), {}) &&
        deepEqual(hostEditor1Delegate.getSelectionsForSiteId(guest3Portal.siteId), {})
      ))

      // Ensure transitive following works when activating other editor proxies.
      const hostBufferProxy2 = await hostPortal.createBufferProxy({uri: 'buffer-b', text: ('x'.repeat(30) + '\n').repeat(30)})
      const hostEditorProxy2 = await hostPortal.createEditorProxy({
        bufferProxy: hostBufferProxy2,
        selections: {1: {range: {start: {row: 5, column: 5}, end: {row: 5, column: 5}}}}
      })
      const hostEditor2Delegate = new FakeEditorDelegate()
      hostEditorProxy2.setDelegate(hostEditor2Delegate)
      hostPortal.activateEditorProxy(hostEditorProxy2)

      await condition(() => (
        deepEqual(guest1PortalDelegate.getTetherPosition(), {row: 5, column: 5}) &&
        deepEqual(guest2PortalDelegate.getTetherPosition(), {row: 5, column: 5}) &&
        deepEqual(guest3PortalDelegate.getTetherPosition(), {row: 5, column: 5}) &&
        deepEqual(hostEditor1Delegate.getSelectionsForSiteId(guest1Portal.siteId), {}) &&
        deepEqual(hostEditor1Delegate.getSelectionsForSiteId(guest2Portal.siteId), {}) &&
        deepEqual(hostEditor1Delegate.getSelectionsForSiteId(guest3Portal.siteId), {})
      ))

      // Disconnecting the tether on Guest1 breaks transitivity.
      const guest1Editor2Proxy = guest1PortalDelegate.getTetherEditorProxy()
      const guest1Editor2Delegate = new FakeEditorDelegate()
      guest1Editor2Delegate.updateViewport(6, 15)
      guest1Editor2Proxy.setDelegate(guest1Editor2Delegate)

      guest1Editor2Proxy.updateSelections({
        1: {range: {start: {row: 13, column: 13}, end: {row: 13, column: 13}}}
      })
      hostEditorProxy2.updateSelections({
        1: {range: {start: {row: 0, column: 0}, end: {row: 0, column: 0}}}
      })
      await condition(() => {
        const selection = hostEditor2Delegate.getSelectionsForSiteId(guest1Portal.siteId)[1]
        return (
          selection && deepEqual(selection.range, {start: {row: 13, column: 13}, end: {row: 13, column: 13}}) &&
          deepEqual(guest2PortalDelegate.getTetherPosition(), {row: 13, column: 13}) &&
          deepEqual(hostEditor2Delegate.getSelectionsForSiteId(3), {})
        )
      })
    })

    test('transitive tethering (with cycles)', async () => {
      const host = await buildClient()
      const guest1 = await buildClient()
      const guest2 = await buildClient()

      const hostPortal = await host.createPortal()
      const hostPortalDelegate = new FakePortalDelegate()
      hostPortal.setDelegate(hostPortalDelegate)

      const hostBufferProxy = await hostPortal.createBufferProxy({uri: 'buffer-a', text: ('x'.repeat(30) + '\n').repeat(30)})
      const hostEditorProxy = await hostPortal.createEditorProxy({
        bufferProxy: hostBufferProxy,
        selections: {1: {range: {start: {row: 5, column: 5}, end: {row: 5, column: 5}}}}
      })
      const hostEditorDelegate = new FakeEditorDelegate()
      hostEditorProxy.setDelegate(hostEditorDelegate)
      hostPortal.activateEditorProxy(hostEditorProxy)

      const guest1PortalDelegate = new FakePortalDelegate()
      const guest1Portal = await guest1.joinPortal(hostPortal.id)
      await guest1Portal.setDelegate(guest1PortalDelegate)

      const guest1EditorProxy = guest1PortalDelegate.getTetherEditorProxy()
      const guest1EditorDelegate = new FakeEditorDelegate()
      guest1EditorDelegate.updateViewport(5, 15)
      guest1EditorProxy.setDelegate(guest1EditorDelegate)

      const guest2PortalDelegate = new FakePortalDelegate()
      const guest2Portal = await guest2.joinPortal(hostPortal.id)
      await guest2Portal.setDelegate(guest2PortalDelegate)

      const guest2EditorProxy = guest2PortalDelegate.getTetherEditorProxy()
      const guest2EditorDelegate = new FakeEditorDelegate()
      guest2EditorDelegate.updateViewport(5, 15)
      guest2EditorProxy.setDelegate(guest2EditorDelegate)

      // Disconnect guest1's tether.
      guest1Portal.unfollow()
      guest1EditorProxy.updateSelections({1: {range: range([0, 0], [0, 0])}})

      await condition(() => {
        const guest1SelectionOnHost = hostEditorDelegate.getSelectionsForSiteId(guest1Portal.siteId)[1]
        const guest1SelectionOnGuest2 = guest2EditorDelegate.getSelectionsForSiteId(guest1Portal.siteId)[1]
        return (
          guest1SelectionOnHost && deepEqual(guest1SelectionOnHost.range, range([0, 0], [0, 0])) &&
          guest1SelectionOnGuest2 && deepEqual(guest1SelectionOnGuest2.range, range([0, 0], [0, 0]))
        )
      })

      // Form a cycle (guest1 -> guest2 -> host -> guest1) and ensure it gets
      // broken on the site with the lowest site id.
      guest1Portal.follow(guest2Portal.siteId)
      guest2Portal.follow(hostPortal.siteId)
      hostPortal.follow(guest1Portal.siteId)

      await condition(() => (
        deepEqual(hostPortalDelegate.getTetherPosition(), {row: 5, column: 5}) &&
        deepEqual(guest1PortalDelegate.getTetherPosition(), {row: 5, column: 5}) &&
        deepEqual(guest2PortalDelegate.getTetherPosition(), {row: 5, column: 5})
      ))

      assert.equal(hostPortal.getFollowedSiteId(), null)
      assert.equal(hostPortalDelegate.getTetherState(), FollowState.DISCONNECTED)

      assert.equal(guest1Portal.getFollowedSiteId(), guest2Portal.siteId)
      assert.equal(guest1PortalDelegate.getTetherState(), FollowState.RETRACTED)

      assert.equal(guest2Portal.getFollowedSiteId(), hostPortal.siteId)
      assert.equal(guest2PortalDelegate.getTetherState(), FollowState.RETRACTED)

      // The site which breaks the cycle becomes the leader.
      guest1EditorProxy.updateSelections({
        1: {range: {start: {row: 13, column: 13}, end: {row: 13, column: 13}}}
      })
      guest1Portal.unfollow()

      await condition(() => (
        deepEqual(hostPortalDelegate.getTetherPosition(), {row: 13, column: 13}) &&
        deepEqual(guest1PortalDelegate.getTetherPosition(), {row: 13, column: 13}) &&
        deepEqual(guest2PortalDelegate.getTetherPosition(), {row: 13, column: 13})
      ))

      assert.equal(hostPortal.getFollowedSiteId(), guest1Portal.siteId)
      assert.equal(hostPortalDelegate.getTetherState(), FollowState.RETRACTED)

      assert.equal(guest1Portal.getFollowedSiteId(), null)
      assert.equal(guest1PortalDelegate.getTetherState(), FollowState.DISCONNECTED)

      assert.equal(guest2Portal.getFollowedSiteId(), hostPortal.siteId)
      assert.equal(guest2PortalDelegate.getTetherState(), FollowState.RETRACTED)
    })
  })

  test('active positions of other collaborators', async () => {
    const host = await buildClient()
    const guest1 = await buildClient()
    const guest2 = await buildClient()

    const portals = []

    const hostPortal = await host.createPortal()
    const hostPortalDelegate = new FakePortalDelegate()
    hostPortal.setDelegate(hostPortalDelegate)
    portals.push(hostPortal)

    const hostBufferProxy1 = await hostPortal.createBufferProxy({uri: 'buffer-a', text: ('x'.repeat(30) + '\n').repeat(30)})
    const hostEditorProxy1 = await hostPortal.createEditorProxy({
      bufferProxy: hostBufferProxy1,
      selections: {1: {range: {start: {row: 5, column: 5}, end: {row: 5, column: 5}}}}
    })
    hostPortal.activateEditorProxy(hostEditorProxy1)

    const guest1PortalDelegate = new FakePortalDelegate()
    const guest1Portal = await guest1.joinPortal(hostPortal.id)
    await guest1Portal.setDelegate(guest1PortalDelegate)
    portals.push(guest1Portal)

    const guest2PortalDelegate = new FakePortalDelegate()
    const guest2Portal = await guest2.joinPortal(hostPortal.id)
    await guest2Portal.setDelegate(guest2PortalDelegate)
    portals.push(guest2Portal)

    // Update active positions after the leader updates its selections.
    hostEditorProxy1.updateSelections({
      1: {range: range([5, 4], [9, 6])},
      2: {range: range([2, 7], [4, 4])}
    })

    await assertActivePositions([
      {siteId: 1, editorProxyId: hostEditorProxy1.id, position: point(4, 4)},
      {siteId: 2, editorProxyId: hostEditorProxy1.id, position: point(4, 4)},
      {siteId: 3, editorProxyId: hostEditorProxy1.id, position: point(4, 4)}
    ])

    // Update active positions after a text change.
    hostBufferProxy1.setTextInRange(point(4, 0), point(4, 0), 'X')

    await assertActivePositions([
      {siteId: 1, editorProxyId: hostEditorProxy1.id, position: point(4, 5)},
      {siteId: 2, editorProxyId: hostEditorProxy1.id, position: point(4, 5)},
      {siteId: 3, editorProxyId: hostEditorProxy1.id, position: point(4, 5)}
    ])

    // Update active positions after the leader changes.
    guest1PortalDelegate.getTetherEditorProxy().updateSelections({
      1: {range: range([5, 4], [9, 6]), reversed: true}
    })
    guest2Portal.follow(guest1Portal.siteId)

    await assertActivePositions([
      {siteId: 1, editorProxyId: hostEditorProxy1.id, position: point(4, 5)},
      {siteId: 2, editorProxyId: hostEditorProxy1.id, position: point(5, 4)},
      {siteId: 3, editorProxyId: hostEditorProxy1.id, position: point(5, 4)}
    ])

    // Update active positions after host switches to a different editor proxy.
    const hostBufferProxy2 = await hostPortal.createBufferProxy({uri: 'buffer-b', text: ('x'.repeat(30) + '\n').repeat(30)})
    const hostEditorProxy2 = await hostPortal.createEditorProxy({
      bufferProxy: hostBufferProxy2,
      selections: {1: {range: {start: {row: 2, column: 2}, end: {row: 2, column: 2}}}}
    })
    hostPortal.activateEditorProxy(hostEditorProxy2)

    await assertActivePositions([
      {siteId: 1, editorProxyId: hostEditorProxy2.id, position: point(2, 2)},
      {siteId: 2, editorProxyId: hostEditorProxy1.id, position: point(5, 4)},
      {siteId: 3, editorProxyId: hostEditorProxy1.id, position: point(5, 4)}
    ])

    // Update active positions after a guest switches to a different editor proxy.
    const guest1EditorProxy2Metadata = guest1Portal.getEditorProxiesMetadata().find((e) => e.bufferProxyURI === 'buffer-b')
    const guest1EditorProxy2 = await guest1Portal.findOrFetchEditorProxy(guest1EditorProxy2Metadata.id)
    guest1Portal.activateEditorProxy(guest1EditorProxy2)
    guest1EditorProxy2.updateSelections({
      1: {range: range([1, 0], [1, 0])}
    }, {initialUpdate: true})

    await assertActivePositions([
      {siteId: 1, editorProxyId: hostEditorProxy2.id, position: point(2, 2)},
      {siteId: 2, editorProxyId: hostEditorProxy2.id, position: point(1, 0)},
      {siteId: 3, editorProxyId: hostEditorProxy2.id, position: point(1, 0)}
    ])

    // Update active positions after a site disconnects.
    guest2Portal.dispose()

    await assertActivePositions([
      {siteId: 1, editorProxyId: hostEditorProxy2.id, position: point(2, 2)},
      {siteId: 2, editorProxyId: hostEditorProxy2.id, position: point(1, 0)}
    ])

    // Update active positions after participant switches focus to something outside of the portal.
    hostPortal.activateEditorProxy(null)

    await assertActivePositions([
      {siteId: 1, editorProxyId: null, position: null},
      {siteId: 2, editorProxyId: hostEditorProxy2.id, position: point(1, 0)}
    ])

    function assertActivePositions (expectedPositions) {
      const alivePortals = portals.filter((p) => !p.disposed)
      return condition(() =>
        alivePortals.every((p) => deepEqual(p.delegate.getActivePositions(), expectedPositions))
      )
    }
  })

  test('disposing editor and buffer proxies', async () => {
    const host = await buildClient()
    const guest = await buildClient()

    const hostPortal = await host.createPortal()
    const hostBufferProxy = await hostPortal.createBufferProxy({uri: 'some-buffer', text: ''})
    hostBufferProxy.setDelegate(new FakeBufferDelegate())
    const hostEditorProxy1 = await hostPortal.createEditorProxy({bufferProxy: hostBufferProxy, selections: {}})
    hostEditorProxy1.setDelegate(new FakeEditorDelegate())
    const hostEditorProxy2 = await hostPortal.createEditorProxy({bufferProxy: hostBufferProxy, selections: {}})
    hostEditorProxy2.setDelegate(new FakeEditorDelegate())

    hostPortal.activateEditorProxy(hostEditorProxy1)

    const guestPortal = await guest.joinPortal(hostPortal.id)
    const guestPortalDelegate = new FakePortalDelegate()
    await guestPortal.setDelegate(guestPortalDelegate)
    await condition(() => guestPortalDelegate.getTetherEditorProxy() != null)
    const guestEditorProxy1 = guestPortalDelegate.getTetherEditorProxy()
    guestEditorProxy1.setDelegate(new FakeEditorDelegate())

    hostPortal.activateEditorProxy(hostEditorProxy2)
    await condition(() => guestPortalDelegate.getTetherEditorProxy() !== guestEditorProxy1)
    const guestEditorProxy2 = guestPortalDelegate.getTetherEditorProxy()
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

  test('save requests', async () => {
    const host = await buildClient()
    const hostPortal = await host.createPortal()

    const hostBufferProxy = await hostPortal.createBufferProxy({uri: 'buffer-a', text: ''})
    const hostBufferDelegate = new FakeBufferDelegate('')
    hostBufferProxy.setDelegate(hostBufferDelegate)

    const hostEditorProxy = await hostPortal.createEditorProxy({bufferProxy: hostBufferProxy, selections: {}})
    hostPortal.activateEditorProxy(hostEditorProxy)

    const guest1 = await buildClient()
    const guest1PortalDelegate = new FakePortalDelegate()
    const guest1Portal = await guest1.joinPortal(hostPortal.id)
    guest1Portal.setDelegate(guest1PortalDelegate)
    const guest1EditorProxy = guest1PortalDelegate.getTetherEditorProxy()
    const guest1BufferProxy = guest1EditorProxy.bufferProxy

    const guest2 = await buildClient()
    const guest2PortalDelegate = new FakePortalDelegate()
    const guest2Portal = await guest2.joinPortal(hostPortal.id)
    guest2Portal.setDelegate(guest2PortalDelegate)
    const guest2EditorProxy = guest2PortalDelegate.getTetherEditorProxy()
    const guest2BufferProxy = guest2EditorProxy.bufferProxy

    guest1BufferProxy.requestSave()
    guest2BufferProxy.requestSave()

    await condition(() => hostBufferDelegate.saveRequestCount === 2)
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
      await guest1Portal.setDelegate(guest1PortalDelegate)

      const guest2 = await buildClient()
      guest2PortalDelegate = new FakePortalDelegate()
      guest2Portal = await guest2.joinPortal(hostPortal.id)
      await guest2Portal.setDelegate(guest2PortalDelegate)

      const guest3 = await buildClient()
      guest3PortalDelegate = new FakePortalDelegate()
      guest3Portal = await guest3.joinPortal(hostPortal.id)
      await guest3Portal.setDelegate(guest3PortalDelegate)

      const hostBufferDelegate = new FakeBufferDelegate('')
      const hostBufferProxy = await hostPortal.createBufferProxy({uri: 'some-buffer', text: hostBufferDelegate.text})
      hostBufferProxy.setDelegate(hostBufferDelegate)

      const hostEditorProxy = await hostPortal.createEditorProxy({bufferProxy: hostBufferProxy, selections: {}})
      hostEditorDelegate = new FakeEditorDelegate()
      hostEditorProxy.setDelegate(hostEditorDelegate)
      hostPortal.activateEditorProxy(hostEditorProxy)

      await condition(() =>
        guest1PortalDelegate.getTetherEditorProxy() != null &&
        guest2PortalDelegate.getTetherEditorProxy() != null &&
        guest3PortalDelegate.getTetherEditorProxy() != null
      )

      const guest1EditorProxy = guest1PortalDelegate.getTetherEditorProxy()
      const guest1BufferProxy = guest1EditorProxy.bufferProxy
      const guest1BufferDelegate = new FakeBufferDelegate()
      guest1BufferProxy.setDelegate(guest1BufferDelegate)
      guest1EditorDelegate = new FakeEditorDelegate()
      guest1EditorProxy.setDelegate(guest1EditorDelegate)
      guest1EditorProxy.updateSelections(
        {1: {range: {start: {row: 0, column: 0}, end: {row: 0, column: 0}}}}
      )

      const guest2EditorProxy = guest2PortalDelegate.getTetherEditorProxy()
      const guest2BufferProxy = guest2EditorProxy.bufferProxy
      const guest2BufferDelegate = new FakeBufferDelegate()
      guest2BufferProxy.setDelegate(guest2BufferDelegate)
      guest2EditorDelegate = new FakeEditorDelegate()
      guest2EditorProxy.setDelegate(guest2EditorDelegate)
      guest2EditorProxy.updateSelections(
        {1: {range: {start: {row: 0, column: 0}, end: {row: 0, column: 0}}}}
      )

      const guest3EditorProxy = guest3PortalDelegate.getTetherEditorProxy()
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
      assert(!hostEditorDelegate.isDisposed())
      assert(!guest2EditorDelegate.isDisposed())
      assert(!guest3EditorDelegate.isDisposed())
      assert(hostEditorDelegate.getSelectionsForSiteId(guest2Portal.siteId))
      assert(hostEditorDelegate.getSelectionsForSiteId(guest3Portal.siteId))
    })

    test('host closing a portal', async () => {
      assert(!guest1PortalDelegate.hasHostClosedPortal() && !guest2PortalDelegate.hasHostClosedPortal() && !guest3PortalDelegate.hasHostClosedPortal())
      hostPortal.dispose()
      await condition(() => guest1PortalDelegate.hasHostClosedPortal() && guest2PortalDelegate.hasHostClosedPortal() && guest3PortalDelegate.hasHostClosedPortal())

      assert(guest1EditorDelegate.isDisposed())
      assert(guest2EditorDelegate.isDisposed())
      assert(guest3EditorDelegate.isDisposed())
    })

    test('losing connection to guest', async () => {
      guest1Portal.peerPool.disconnect()
      await condition(() =>
        hostEditorDelegate.getSelectionsForSiteId(guest1Portal.siteId) == null &&
        guest2EditorDelegate.getSelectionsForSiteId(guest1Portal.siteId) == null &&
        guest3EditorDelegate.getSelectionsForSiteId(guest1Portal.siteId) == null
      )
      assert(hostEditorDelegate.getSelectionsForSiteId(guest2Portal.siteId))
      assert(hostEditorDelegate.getSelectionsForSiteId(guest3Portal.siteId))
    })

    test('losing connection to host', async () => {
      hostPortal.peerPool.disconnect()
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

  test('simultaneously hosting a portal and participating as a guest in other portals', async () => {
    const client1 = await buildClient()
    const client2 = await buildClient()

    // client1 hosts a portal with client2 as a guest
    const client1HostPortal = await client1.createPortal()
    const client1BufferProxy = await client1HostPortal.createBufferProxy({uri: 'client-1-buffer', text: ''})
    const client1EditorProxy = await client1HostPortal.createEditorProxy({bufferProxy: client1BufferProxy, selections: {}})
    client1HostPortal.activateEditorProxy(client1EditorProxy)

    const client2GuestPortalDelegate = new FakePortalDelegate()
    const client2GuestPortal = await client2.joinPortal(client1HostPortal.id)
    await client2GuestPortal.setDelegate(client2GuestPortalDelegate)
    assert.equal(client2GuestPortalDelegate.getTetherBufferProxyURI(), 'client-1-buffer')

    // while still participating as a guest in the portal above, client2 hosts a portal with client1 as a guest
    const client2HostPortal = await client2.createPortal()
    const client2BufferProxy = await client2HostPortal.createBufferProxy({uri: 'client-2-buffer', text: ''})
    const client2EditorProxy = await client2HostPortal.createEditorProxy({bufferProxy: client2BufferProxy, selections: {}})
    client2HostPortal.activateEditorProxy(client2EditorProxy)

    const client1GuestPortalDelegate = new FakePortalDelegate()
    const client1GuestPortal = await client1.joinPortal(client2HostPortal.id)
    await client1GuestPortal.setDelegate(client1GuestPortalDelegate)
    assert.equal(client1GuestPortalDelegate.getTetherBufferProxyURI(), 'client-2-buffer')
  })

  test('attempting to join a non-existent portal', async () => {
    const client = await buildClient()

    // Well-formed, but non-existent portal ID.
    {
      let exception
      try {
        await client.joinPortal('00000000-0000-0000-0000-000000000000')
      } catch (e) {
        exception = e
      }
      assert(exception instanceof Errors.PortalNotFoundError)
    }

    // Malformed Portal ID.
    {
      let exception
      try {
        await client.joinPortal('malformed-portal-id')
      } catch (e) {
        exception = e
      }
      assert(exception instanceof Errors.PortalNotFoundError)
    }
  })

  suite('authentication', () => {
    test('signing in using a valid token', async () => {
      const client = await buildClient({signIn: false})

      server.identityProvider.setIdentitiesByToken({
        'token-1': {login: 'user-1'},
        'token-2': {login: 'user-2'}
      })

      assert(await client.signIn('token-1'))
      assert(client.isSignedIn())
      assert.equal(client.getLocalUserIdentity().login, 'user-1')
      assert.equal(client.testSignInChangeEvents.length, 1)
      assert(!client.peerPool.disposed)

      const {peerPool} = client
      client.signOut()
      assert(!client.isSignedIn())
      assert(!client.getLocalUserIdentity())
      assert.equal(client.testSignInChangeEvents.length, 2)
      assert(peerPool.disposed)

      assert(await client.signIn('token-2'))
      assert(client.isSignedIn())
      assert.equal(client.getLocalUserIdentity().login, 'user-2')
      assert.equal(client.testSignInChangeEvents.length, 3)
      assert(!client.peerPool.disposed)
    })

    test('signing in using an invalid token', async () => {
      const client = await buildClient({signIn: false})

      server.identityProvider.setIdentitiesByToken({
        'invalid-token': null
      })

      assert(!await client.signIn('invalid-token'))
      assert(!client.isSignedIn())
      assert(!client.getLocalUserIdentity())
      assert.equal(client.testSignInChangeEvents.length, 0)
    })

    test('creating a portal after auth token has been revoked', async () => {
      const client = await buildClient({signIn: false})

      await client.signIn('some-token')
      assert(client.isSignedIn())

      server.identityProvider.setIdentitiesByToken({
        'some-token': null
      })

      assert(!await client.createPortal())
      assert(!client.isSignedIn())
    })

    test('joining a portal after auth token has been revoked', async () => {
      const client = await buildClient({signIn: false})

      await client.signIn('some-token')
      assert(client.isSignedIn())

      server.identityProvider.setIdentitiesByToken({
        'some-token': null
      })

      assert(!await client.joinPortal('some-portal'))
      assert(!client.isSignedIn())
    })
  })

  let nextTokenId = 1
  async function buildClient (options={}) {
    const client = new TeletypeClient({
      restGateway: new RestGateway({baseURL: server.address}),
      pubSubGateway: server.pubSubGateway || new PusherPubSubGateway(server.pusherCredentials),
      didCreateOrJoinPortal: (portal) => portals.push(portal),
      tetherDisconnectWindow: 100,
      testEpoch
    })

    client.testSignInChangeEvents = []
    client.onSignInChange((event) => client.testSignInChangeEvents.push(event))

    // Ensure we don't blow up if we call `initialize` a second time before
    // finishing initialization.
    await Promise.all([client.initialize(), client.initialize()])
    if (options.signIn !== false) {
      await client.signIn('token-' + nextTokenId++)
    }

    return client
  }

  function range (start, end) {
    return {
      start: point(...start),
      end: point(...end)
    }
  }

  function point (row, column) {
    return {row, column}
  }
})
