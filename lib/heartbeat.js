module.exports =
class Heartbeat {
  constructor ({restGateway, portalId, siteId, intervalInMilliseconds}) {
    this.restGateway = restGateway
    this.portalId = portalId
    this.siteId = siteId
    this.intervalInMilliseconds = intervalInMilliseconds
    this.intervalId = null
    this.pendingThumps = 0
  }

  start () {
    this.intervalId = setInterval(() => this.thump(), this.heartbeatIntervalInMilliseconds)
  }

  stop () {
    clearInterval(this.intervalId)
    this.intervalId = null
  }

  isStopped() {
    return this.intervalId == null && this.pendingThumps === 0
  }

  async thump () {
    const promise = this.restGateway.post(`/portals/${this.portalId}/sites/${this.siteId}/heartbeats`)
    this.pendingThumps++
    await promise
    this.pendingThumps--
  }
}
