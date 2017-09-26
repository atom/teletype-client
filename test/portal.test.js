const assert = require('assert')
const {Disposable} = require('event-kit')
const {startTestServer} = require('@atom/real-time-server')
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

    const hostPortal = buildPortal('portal', hostPeerPool)
    const guest1Portal = buildPortal('portal', guest1PeerPool, 'host')
    const guest2Portal = buildPortal('portal', guest2PeerPool, 'host')
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

    hostPortal.dispose()
    await condition(() => (
      setEqual(hostPortal.getActiveSiteIds(), [1]) &&
      setEqual(guest1Portal.getActiveSiteIds(), [2]) &&
      setEqual(guest2Portal.getActiveSiteIds(), [3])
    ))

    assert.deepEqual(hostPortal.testDelegate.leaveEvents, [2])
    assert.deepEqual(guest1Portal.testDelegate.leaveEvents, [])
    assert.deepEqual(guest2Portal.testDelegate.leaveEvents, [2, 1])
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

    const hostPortal = buildPortal('portal', hostPeerPool)
    const guest1Portal = buildPortal('portal', guest1PeerPool, 'host')
    const guest2Portal = buildPortal('portal', guest2PeerPool, 'host')
    await guest1Portal.join()
    await guest2Portal.join()

    assert.deepEqual(hostPortal.getSiteIdentity(1), hostIdentity)
    assert.deepEqual(hostPortal.getSiteIdentity(2), guest1Identity)
    assert.deepEqual(hostPortal.getSiteIdentity(3), guest2Identity)

    assert.deepEqual(guest1Portal.getSiteIdentity(1), hostIdentity)
    assert.deepEqual(guest1Portal.getSiteIdentity(2), guest1Identity)
    assert.deepEqual(guest1Portal.getSiteIdentity(3), guest2Identity)

    assert.deepEqual(guest2Portal.getSiteIdentity(1), hostIdentity)
    assert.deepEqual(guest2Portal.getSiteIdentity(2), guest1Identity)
    assert.deepEqual(guest2Portal.getSiteIdentity(3), guest2Identity)
  })

  function buildPortal (portalId, peerPool, hostPeerId) {
    const siteId = hostPeerId == null ? 1 : null
    const portal = new Portal({id: portalId, hostPeerId, siteId, peerPool})
    portal.testDelegate = new FakePortalDelegate()
    portal.setDelegate(portal.testDelegate)
    return portal
  }
})
