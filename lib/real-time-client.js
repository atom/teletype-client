const PeerPool = require('./peer-pool')
const Portal = require('./portal')
const Errors = require('./errors')
const PusherPubSubGateway = require('./pusher-pub-sub-gateway')
const RestGateway = require('./rest-gateway')
const NOOP = () => {}
const TIMEOUT_SYMBOL = Symbol('timeout')

module.exports =
class RealTimeClient {
  constructor ({restGateway, pubSubGateway, timeoutInMilliseconds, testEpoch, pusherKey, baseURL, didCreateOrJoinPortal}) {
    this.pusherKey = pusherKey
    this.restGateway = restGateway || new RestGateway({baseURL})
    this.pubSubGateway = pubSubGateway
    this.timeoutInMilliseconds = timeoutInMilliseconds || 5000
    this.testEpoch = testEpoch
    this.didCreateOrJoinPortal = didCreateOrJoinPortal || NOOP
  }

  async initialize () {
    if (!this.pubSubGateway) this.pubSubGateway = new PusherPubSubGateway({key: this.pusherKey})

    const peerId = await Promise.race([this.pubSubGateway.getClientId(), this.getNewTimeoutPromise()])
    if (peerId === TIMEOUT_SYMBOL) {
      throw new Errors.PubSubConnectionError('Retrieving client identity timed out')
    } else {
      this.peerId = peerId
      this.peerPool = new PeerPool({
        peerId: this.peerId,
        restGateway: this.restGateway,
        pubSubGateway: this.pubSubGateway,
        fragmentSize: 16 * 1024, // 16KB
        timeoutInMilliseconds: this.timeoutInMilliseconds,
        testEpoch: this.testEpoch
      })
      await this.peerPool.initialize()
    }
  }

  dispose () {
    if (this.peerPool) this.peerPool.disconnect()
  }

  async createPortal () {
    const {ok, body} = await this.restGateway.post('/portals', {
      hostPeerId: this.peerId
    })

    if (ok) {
      const {id} = body
      const portal = new Portal({id, siteId: 1, peerPool: this.peerPool})
      this.didCreateOrJoinPortal(portal)

      return portal
    } else {
      throw new Errors.PortalCreationError()
    }
  }

  async joinPortal (id) {
    const {ok, body} = await this.restGateway.get(`/portals/${id}`)
    if (ok) {
      const {hostPeerId} = body
      const portal = new Portal({id, hostPeerId, peerPool: this.peerPool})
      await portal.join()
      this.didCreateOrJoinPortal(portal)

      return portal
    } else {
      throw new Errors.PortalNotFoundError()
    }
  }

  getNewTimeoutPromise () {
    return new Promise((resolve) => {
      setTimeout(() => resolve(TIMEOUT_SYMBOL), this.timeoutInMilliseconds)
    })
  }
}
