const SharedBuffer = require('./shared-buffer')
const {serializeRemotePosition, deserializeRemotePosition} = require('@atom/tachyon')
const FragmentInbox = require('./fragment-inbox')

module.exports =
class SharedEditor {
  constructor ({id, siteId, sharedBuffer, restGateway, pubSubGateway, taskQueue}) {
    this.id = id
    this.siteId = siteId
    this.sharedBuffer = sharedBuffer
    this.restGateway = restGateway
    this.pubSubGateway = pubSubGateway
    this.taskQueue = taskQueue
    this.nextMessageId = 1
    this.inbox = new FragmentInbox()
    this.selectionMarkerLayersBySiteId = {}
  }

  dispose () {
    if (this.subscription) this.subscription.dispose()
    if (this.sharedBuffer) this.sharedBuffer.dispose()
  }

  async create ({sharedBuffer, selectionRanges}) {
    this.sharedBuffer = sharedBuffer
    this.selectionMarkerLayersBySiteId = {
      1: selectionRanges
    }

    const {replica} = this.sharedBuffer
    const {id} = await this.restGateway.post(
      `/shared-editors`,
      {
        sharedBufferId: this.sharedBuffer.id,
        selectionRanges: this.serializeMarkerRanges(selectionRanges)
      }
    )
    this.id = id
    await this.subscribe()
  }

  async join () {
    const {sharedBufferId, selectionMarkerLayersBySiteId} = await this.restGateway.get(`/shared-editors/${this.id}`)
    this.sharedBuffer = new SharedBuffer({
      id: sharedBufferId,
      siteId: this.siteId,
      restGateway: this.restGateway,
      pubSubGateway: this.pubSubGateway,
      taskQueue: this.taskQueue
    })
    await this.sharedBuffer.join()
    await this.subscribe()
    for (const siteId in selectionMarkerLayersBySiteId) {
      this.selectionMarkerLayersBySiteId[siteId] = await this.deserializeMarkerRanges(selectionMarkerLayersBySiteId[siteId])
    }
  }

  async subscribe () {
    this.subscription = await this.pubSubGateway.subscribe(
      `/shared-editors/${this.id}`,
      'update',
      this.receiveUpdate.bind(this)
    )
  }

  setDelegate (delegate) {
    this.delegate = delegate
    for (let siteId in this.selectionMarkerLayersBySiteId) {
      siteId = Number(siteId)
      if (siteId !== this.siteId) {
        this.delegate.setSelectionMarkerLayerForSiteId(
          siteId,
          this.selectionMarkerLayersBySiteId[siteId]
        )
      }
    }
  }

  setSelectionRanges (selectionRanges) {
    const id = `/shared-editors/${this.id}/selection-marker-layers/${this.siteId}`
    this.taskQueue.cancelPending(id)
    this.taskQueue.push({
      id,
      data: this.serializeMarkerRanges(selectionRanges),
      coalesce: this.coalesceSelectionRanges,
      execute: this.sendSelectionRanges.bind(this)
    })
  }

  // Private
  coalesceSelectionRanges (selectionRanges) {
    return selectionRanges[selectionRanges.length - 1]
  }

  // Private
  sendSelectionRanges (selectionRanges) {
    return this.restGateway.put(
      `/shared-editors/${this.id}/selection-marker-layers/${this.siteId}`,
      {
        markerRanges: selectionRanges,
        messageId: this.siteId + '.' + this.nextMessageId++
      }
    )
  }

  async receiveUpdate (envelope) {
    let message = this.inbox.receive(envelope)
    if (message) {
      const {siteId, markerRanges: remoteMarkerRanges} = message
      const markerLayer = await this.deserializeMarkerRanges(remoteMarkerRanges)
      this.selectionMarkerLayersBySiteId[siteId] = markerLayer
      if (this.delegate && siteId !== this.siteId) {
        this.delegate.setSelectionMarkerLayerForSiteId(
          siteId,
          this.selectionMarkerLayersBySiteId[siteId]
        )
      }
    }
  }

  siteDidDisconnect (siteId) {
    this.selectionMarkerLayersBySiteId[siteId] = null
    this.delegate.setSelectionMarkerLayerForSiteId(siteId, null)
  }

  hostDidDisconnect () {
    this.getOtherSiteIds().forEach((id) => this.siteDidDisconnect(id))
  }

  getOtherSiteIds () {
    const siteIds = []
    for (let siteId in this.selectionMarkerLayersBySiteId) {
      siteId = parseInt(siteId)
      if (siteId !== this.siteId) siteIds.push(siteId)
    }
    return siteIds
  }

  serializeMarkerRanges (localRanges) {
    const remoteMarkerRanges = {}
    for (const id in localRanges) {
      const {start, end} = localRanges[id]
      remoteMarkerRanges[id] = {
        start: this.serializeRemotePosition(start),
        end: this.serializeRemotePosition(end)
      }
    }
    return JSON.stringify(remoteMarkerRanges)
  }

  async deserializeMarkerRanges (serializedRemoteRanges) {
    const remoteRanges = JSON.parse(serializedRemoteRanges)
    const localRanges = {}
    for (const id in remoteRanges) {
      const {start, end} = remoteRanges[id]
      localRanges[id] = {
        start: await this.deserializeRemotePosition(start),
        end: await this.deserializeRemotePosition(end)
      }
    }
    return localRanges
  }

  serializeRemotePosition (remotePosition) {
    return new Buffer(serializeRemotePosition(
      this.sharedBuffer.replica.getRemotePosition(remotePosition)
    )).toString('base64')
  }

  deserializeRemotePosition (data) {
    return this.sharedBuffer.replica.getLocalPosition(
      deserializeRemotePosition(new Buffer(data, 'base64'))
    )
  }
}
