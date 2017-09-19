const PeerPool = require('./peer-pool')
const Portal = require('./portal')
const Errors = require('./errors')
const PusherPubSubGateway = require('./pusher-pub-sub-gateway')
const RestGateway = require('./rest-gateway')
const NOOP = () => {}

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

    this.peerId = await this.getClientId()
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

  getClientId () {
    const timeoutError = new Errors.PubSubConnectionError('Timed out establishing web socket connection to signaling server')
    return new Promise((resolve, reject) => {
      this.pubSubGateway.getClientId().then(resolve)
      setTimeout(() => reject(timeoutError), this.timeoutInMilliseconds)
    })
  }
}
