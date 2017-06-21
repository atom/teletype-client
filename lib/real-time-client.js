const HostPortal = require('./host-portal')
const GuestPortal = require('./guest-portal')
const PusherPubSubGateway = require('./pusher-pub-sub-gateway')
const RestGateway = require('./rest-gateway')

module.exports =
class RealTimeClient {
  constructor ({restGateway, pubSubGateway, pusherKey, baseURL, heartbeatIntervalInMilliseconds}) {
    this.restGateway = restGateway || new RestGateway({baseURL})
    this.pubSubGateway = pubSubGateway || new PusherPubSubGateway({key: pusherKey})
    this.heartbeatIntervalInMilliseconds = heartbeatIntervalInMilliseconds || (60 * 1000)
  }

  async createPortal () {
    const portal = new HostPortal({
      restGateway: this.restGateway,
      pubSubGateway: this.pubSubGateway,
      heartbeatIntervalInMilliseconds: this.heartbeatIntervalInMilliseconds
    })
    await portal.create()
    return portal
  }

  async joinPortal (portalId) {
    const portal = new GuestPortal({
      id: portalId,
      restGateway: this.restGateway,
      pubSubGateway: this.pubSubGateway
    })
    await portal.join()
    return portal
  }
}
