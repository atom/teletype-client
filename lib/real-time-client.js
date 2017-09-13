const PeerPool = require('./peer-pool')
const Portal = require('./portal')
const PusherPubSubGateway = require('./pusher-pub-sub-gateway')
const RestGateway = require('./rest-gateway')
const NOOP = () => {}

class RealTimeClient {
  constructor ({restGateway, pubSubGateway, testEpoch, pusherKey, baseURL, didCreateOrJoinPortal}) {
    this.pusherKey = pusherKey
    this.restGateway = restGateway || new RestGateway({baseURL})
    this.pubSubGateway = pubSubGateway
    this.testEpoch = testEpoch
    this.didCreateOrJoinPortal = didCreateOrJoinPortal || NOOP
  }

  async initialize () {
    if (!this.pubSubGateway) this.pubSubGateway = new PusherPubSubGateway({key: this.pusherKey})

    this.peerId = await this.pubSubGateway.getClientId()
    this.peerPool = new PeerPool({
      peerId: this.peerId,
      restGateway: this.restGateway,
      pubSubGateway: this.pubSubGateway,
      fragmentSize: 16 * 1024, // 16KB
      testEpoch: this.testEpoch
    })
    await this.peerPool.initialize()
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
      throw new Error('Portal creation failed')
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
      throw new PortalNotFoundError()
    }
  }
}

class PortalNotFoundError extends Error {
  constructor () {
    super(...arguments)
  }
}

module.exports = {RealTimeClient, PortalNotFoundError}
