const assert = require('assert')
const {Disposable} = require('event-kit')
const {startTestServer} = require('@atom/teletype-server')
const {buildPeerPool, clearPeerPools} = require('./helpers/peer-pools')
const condition = require('./helpers/condition')
const setEqual = require('./helpers/set-equal')
const FakePortalDelegate = require('./helpers/fake-portal-delegate')
const Portal = require('../lib/portal')

suite('Portal', () => {
  let server

  suiteSetup(async () => {
    server = await startTestServer()
  })

  suiteTeardown(() => {
    return server.stop()
  })

  setup(() => {
    return server.reset()
  })

  teardown(() => {
    clearPeerPools()
  })

  suite('join', () => {
    test('throws and disposes itself when a network error occurs', async () => {
      const peerPool = await buildPeerPool('guest', server)
      const portal = new Portal({id: 'id', hostPeerId: 'host', siteId: 2, peerPool})
      portal.network.connectTo = function () {
        throw new Error('an error')
      }

      let error
      try {
        await portal.join()
      } catch (e) {
        error = e
      }
      assert.equal(error.message, 'an error')
      assert(portal.disposed)
    })
  })

  test('joining and leaving a portal', async () => {
    const hostPeerPool = await buildPeerPool('host', server)
    const guest1PeerPool = await buildPeerPool('guest1', server)
    const guest2PeerPool = await buildPeerPool('guest2', server)

    const hostPortal = await buildPortal('portal', hostPeerPool)
    const guest1Portal = await buildPortal('portal', guest1PeerPool, 'host')
    const guest2Portal = await buildPortal('portal', guest2PeerPool, 'host')
    await guest1Portal.join()
    await guest2Portal.join()

    assert(setEqual(hostPortal.getActiveSiteIds(), [1, 2, 3]))
    assert(setEqual(guest1Portal.getActiveSiteIds(), [1, 2, 3]))
    assert(setEqual(guest2Portal.getActiveSiteIds(), [1, 2, 3]))

    assert.deepEqual(hostPortal.testDelegate.joinEvents, [2, 3])
    assert.deepEqual(guest1Portal.testDelegate.joinEvents, [3])
    assert.deepEqual(guest2Portal.testDelegate.joinEvents, [])

    guest1Portal.dispose()
    await condition(() => (
      setEqual(hostPortal.getActiveSiteIds(), [1, 3]) &&
      setEqual(guest1Portal.getActiveSiteIds(), [2]) &&
      setEqual(guest2Portal.getActiveSiteIds(), [1, 3])
    ))

    assert.deepEqual(hostPortal.testDelegate.leaveEvents, [2])
    assert.deepEqual(guest1Portal.testDelegate.leaveEvents, [])
    assert.deepEqual(guest2Portal.testDelegate.leaveEvents, [2])

    // Ensure leave event is not emitted when the host disconnects.
    hostPortal.dispose()
    await condition(() => (
      setEqual(hostPortal.getActiveSiteIds(), [1]) &&
      setEqual(guest1Portal.getActiveSiteIds(), [2]) &&
      setEqual(guest2Portal.getActiveSiteIds(), [3])
    ))

    assert.deepEqual(hostPortal.testDelegate.leaveEvents, [2])
    assert.deepEqual(guest1Portal.testDelegate.leaveEvents, [])
    assert.deepEqual(guest2Portal.testDelegate.leaveEvents, [2])
    assert(guest2Portal.testDelegate.hasHostClosedPortal())
  })

  test('site identities', async () => {
    const hostIdentity = {login: 'host'}
    const guest1Identity = {login: 'guest1'}
    const guest2Identity = {login: 'guest2'}

    server.identityProvider.setIdentitiesByToken({
      'host-token': hostIdentity,
      'guest1-token': guest1Identity,
      'guest2-token': guest2Identity
    })

    const hostPeerPool = await buildPeerPool('host', server)
    const guest1PeerPool = await buildPeerPool('guest1', server)
    const guest2PeerPool = await buildPeerPool('guest2', server)

    const hostPortal = await buildPortal('portal', hostPeerPool)
    const guest1Portal = await buildPortal('portal', guest1PeerPool, 'host')
    const guest2Portal = await buildPortal('portal', guest2PeerPool, 'host')
    await guest1Portal.join()
    await guest2Portal.join()

    assert.equal(hostPortal.getSiteIdentity(1).login, hostIdentity.login)
    assert.equal(hostPortal.getSiteIdentity(2).login, guest1Identity.login)
    assert.equal(hostPortal.getSiteIdentity(3).login, guest2Identity.login)

    assert.equal(guest1Portal.getSiteIdentity(1).login, hostIdentity.login)
    assert.equal(guest1Portal.getSiteIdentity(2).login, guest1Identity.login)
    assert.equal(guest1Portal.getSiteIdentity(3).login, guest2Identity.login)

    assert.equal(guest2Portal.getSiteIdentity(1).login, hostIdentity.login)
    assert.equal(guest2Portal.getSiteIdentity(2).login, guest1Identity.login)
    assert.equal(guest2Portal.getSiteIdentity(3).login, guest2Identity.login)
  })

  suite('changing active editor proxy', () => {
    test('host only notifies guests when active editor proxy has changed', async () => {
      const hostPeerPool = await buildPeerPool('host', server)
      const guestPeerPool = await buildPeerPool('guest', server)
      const hostPortal = await buildPortal('portal', hostPeerPool)
      const guestPortal = await buildPortal('portal', guestPeerPool, 'host')
      await guestPortal.join()
      guestPortal.testDelegate.activeEditorProxyChangeCount = 0

      // Don't notify guests when setting the active editor proxy to the same value it currently has.
      hostPortal.setActiveEditorProxy(hostPortal.testDelegate.getActiveEditorProxy())

      // Set the active editor proxy to a different value to ensure guests are notified only of this change.
      const originalBufferProxy = await hostPortal.createBufferProxy({uri: 'original-uri', text: ''})
      const originalEditorProxy = await hostPortal.createEditorProxy({bufferProxy: originalBufferProxy})
      hostPortal.setActiveEditorProxy(originalEditorProxy)
      await condition(() => (
        guestPortal.testDelegate.getActiveBufferProxyURI() === 'original-uri' &&
        guestPortal.testDelegate.activeEditorProxyChangeCount === 1
      ))
    })

    test('guest gracefully handles race conditions', async () => {
      const hostPeerPool = await buildPeerPool('host', server)
      const guestPeerPool = await buildPeerPool('guest', server)
      const hostPortal = await buildPortal('portal', hostPeerPool)
      const guestPortal = await buildPortal('portal', guestPeerPool, 'host')
      await guestPortal.join()
      guestPortal.testDelegate.activeEditorProxyChangeCount = 0

      // Ensure no race condition occurs on the guest when fetching new editor
      // proxies for the first time and, at the same time, receiving a request
      // to switch to a previous value of active editor proxy.
      const newBufferProxy = await hostPortal.createBufferProxy({uri: 'new-uri', text: ''})
      const newEditorProxy = await hostPortal.createEditorProxy({bufferProxy: newBufferProxy})
      hostPortal.setActiveEditorProxy(newEditorProxy)
      hostPortal.setActiveEditorProxy(null)
      await condition(() => (
        guestPortal.testDelegate.getActiveBufferProxyURI() === null &&
        guestPortal.testDelegate.activeEditorProxyChangeCount === 2
      ))
    })

    test('guest gracefully handles switching to an editor proxy whose buffer has already been destroyed', async () => {
      const hostPeerPool = await buildPeerPool('host', server)
      const guestPeerPool = await buildPeerPool('guest', server)
      const hostPortal = await buildPortal('portal', hostPeerPool)
      const guestPortal = await buildPortal('portal', guestPeerPool, 'host')
      await guestPortal.join()
      guestPortal.testDelegate.activeEditorProxyChangeCount = 0

      const bufferProxy1 = await hostPortal.createBufferProxy({uri: 'uri-1', text: ''})
      const editorProxy1 = await hostPortal.createEditorProxy({bufferProxy: bufferProxy1})
      const bufferProxy2 = await hostPortal.createBufferProxy({uri: 'uri-2', text: ''})
      const editorProxy2 = await hostPortal.createEditorProxy({bufferProxy: bufferProxy2})

      hostPortal.setActiveEditorProxy(editorProxy1)
      bufferProxy1.dispose()
      hostPortal.setActiveEditorProxy(null)
      hostPortal.setActiveEditorProxy(editorProxy2)
      await condition(() => (
        guestPortal.testDelegate.getActiveBufferProxyURI() === 'uri-2' &&
        guestPortal.testDelegate.activeEditorProxyChangeCount === 1
      ))
    })

    test('guest gracefully handles switching to an editor proxy that has already been destroyed', async () => {
      const hostPeerPool = await buildPeerPool('host', server)
      const guestPeerPool = await buildPeerPool('guest', server)
      const hostPortal = await buildPortal('portal', hostPeerPool)
      const guestPortal = await buildPortal('portal', guestPeerPool, 'host')
      await guestPortal.join()
      guestPortal.testDelegate.activeEditorProxyChangeCount = 0

      const bufferProxy1 = await hostPortal.createBufferProxy({uri: 'uri-1', text: ''})
      const editorProxy1 = await hostPortal.createEditorProxy({bufferProxy: bufferProxy1})
      const bufferProxy2 = await hostPortal.createBufferProxy({uri: 'uri-2', text: ''})
      const editorProxy2 = await hostPortal.createEditorProxy({bufferProxy: bufferProxy2})

      hostPortal.setActiveEditorProxy(editorProxy1)
      editorProxy1.dispose()
      hostPortal.setActiveEditorProxy(null)
      hostPortal.setActiveEditorProxy(editorProxy2)
      await condition(() => (
        guestPortal.testDelegate.getActiveBufferProxyURI() === 'uri-2' &&
        guestPortal.testDelegate.activeEditorProxyChangeCount === 1
      ))
    })
  })

  async function buildPortal (portalId, peerPool, hostPeerId) {
    const siteId = hostPeerId == null ? 1 : null
    const portal = new Portal({id: portalId, hostPeerId, siteId, peerPool})
    await portal.initialize()
    portal.testDelegate = new FakePortalDelegate()
    portal.setDelegate(portal.testDelegate)
    return portal
  }
})
