const SharedBuffer = require('./shared-buffer')
const {serializeRemotePosition, deserializeRemotePosition} = require('@atom-team/tachyon')
const FragmentInbox = require('./fragment-inbox')

module.exports =
class SharedEditor {
  constructor ({id, sharedBuffer, selectionRanges, restGateway, pubSubGateway}) {
    this.id = id
    this.sharedBuffer = sharedBuffer
    this.selectionRanges = selectionRanges
    this.restGateway = restGateway
    this.pubSubGateway = pubSubGateway
    this.nextMessageId = 1
    this.inbox = new FragmentInbox()
  }

  async create ({sharedBuffer, selectionRanges}) {
    this.sharedBuffer = sharedBuffer
    this.selectionRanges = selectionRanges

    const {replica} = this.sharedBuffer
    const {id} = await this.restGateway.post(
      `/shared-editors`,
      {
        sharedBufferId: this.sharedBuffer.id,
        selectionRanges: this.serializeSelectionRanges(this.selectionRanges)
      }
    )
    this.id = id
  }

  async join () {
    const resourceName = `/shared-editors/${this.id}`
    this.subscription = await this.pubSubGateway.subscribe(
      resourceName,
      'update',
      this.receiveUpdate.bind(this)
    )
    const {sharedBufferId, selectionRanges} = await this.restGateway.get(resourceName)
    this.sharedBuffer = new SharedBuffer({
      id: sharedBufferId,
      restGateway: this.restGateway,
      pubSubGateway: this.pubSubGateway
    })
    await this.sharedBuffer.join()
    this.selectionRanges = await this.deserializeSelectionRanges(selectionRanges)
  }

  setDelegate (delegate) {
    this.delegate = delegate
    this.delegate.setSelectionRanges(this.selectionRanges)
  }

  setSelectionRanges (selectionRanges) {
    this.selectionRanges = selectionRanges
    return this.restGateway.post(
      `/shared-editors/${this.id}/selection-ranges`,
      {
        selectionRanges: this.serializeSelectionRanges(selectionRanges),
        messageId: this.nextMessageId++
      }
    )
  }

  async receiveUpdate (envelope) {
    let message = this.inbox.receive(envelope)
    if (message) {
      const remoteSelectionRanges = message.selectionRanges
      this.pendingRemoteSelectionRanges = remoteSelectionRanges
      const localSelectionRanges = await this.deserializeSelectionRanges(remoteSelectionRanges)
      if (remoteSelectionRanges === this.pendingRemoteSelectionRanges) {
        this.selectionRanges = localSelectionRanges
        if (this.delegate) this.delegate.setSelectionRanges(localSelectionRanges)
      }
    }
  }

  serializeSelectionRanges (selectionRanges) {
    return JSON.stringify(
      selectionRanges.map(({start, end}) => {
        return {
          start: this.serializeRemotePosition(start),
          end: this.serializeRemotePosition(end)
        }
      })
    )
  }

  deserializeSelectionRanges (selectionRanges) {
    return Promise.all(JSON.parse(selectionRanges).map(async ({start, end}) => {
      return {
        start: await this.deserializeRemotePosition(start),
        end: await this.deserializeRemotePosition(end)
      }
    }))
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
