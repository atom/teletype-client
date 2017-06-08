const {
  DocumentReplica, serializeOperation, deserializeOperation
} = require('@atom-team/tachyon')

module.exports =
class SharedBuffer {
  static async create ({delegate, uri, restGateway, pubSubGateway}) {
    const siteId = 1
    const replica = new DocumentReplica(siteId)
    const operation = replica.insertLocal({position: 0, text: delegate.getText()})
    const {id} = await restGateway.post(
      '/shared-buffers',
      {
        uri,
        operations: [new Buffer(serializeOperation(operation)).toString('base64')]
      }
    )
    const sharedBuffer = new SharedBuffer({
      restGateway, pubSubGateway, delegate,
      siteId, id, replica, uri
    })
    await sharedBuffer.subscribe()
    return sharedBuffer
  }

  static async join ({restGateway, pubSubGateway, id, delegate}) {
    const sharedBuffer = new SharedBuffer({restGateway, pubSubGateway, delegate, id})
    await sharedBuffer.join()
    return sharedBuffer
  }

  constructor ({restGateway, pubSubGateway, delegate, siteId, id, replica, uri}) {
    this.restGateway = restGateway
    this.pubSubGateway = pubSubGateway
    this.delegate = delegate
    this.id = id
    this.siteId = siteId
    this.uri = uri
    this.replica = replica
    this.deferredOperations = []
    this.appliedOperationIds = new Set()
    this.incomingMessageEnvelopesById = new Map()
  }

  async join () {
    await this.subscribe()
    const {siteId, uri, operations} = await this.restGateway.post(
      `/shared-buffers/${this.id}/sites`
    )
    this.uri = uri
    this.replica = new DocumentReplica(siteId)
    this.applyRemoteOperations(operations)
    this.applyRemoteOperations(this.deferredOperations)
    this.deferredOperations = null
    this.delegate.setText(this.replica.getText())
  }

  async subscribe () {
    this.subscription = await this.pubSubGateway.subscribe(
      `/shared-buffers/${this.id}`,
      'operations',
      this.receive.bind(this)
    )
  }

  receive (envelope) {
    let message
    if (envelope.fragmentCount === 1) {
      message = envelope.text
    } else {
      let envelopes = this.incomingMessageEnvelopesById.get(envelope.messageId)
      if (!envelopes) {
        envelopes = []
        this.incomingMessageEnvelopesById.set(envelope.messageId, envelopes)
      }

      envelopes.push(envelope)
      if (envelopes.length === envelope.fragmentCount) {
        envelopes.sort((a, b) => a.fragmentIndex - b.fragmentIndex)
        message = ''
        for (let i = 0; i < envelopes.length; i++) {
          message += envelopes[i].text
        }
        this.incomingMessageEnvelopesById.delete(envelope.messageId)
      }
    }

    if (message) {
      const operations = JSON.parse(message)
      if (this.replica) {
        this.applyRemoteOperations(operations)
      } else {
        this.deferredOperations.push(...operations)
      }
    }
  }

  apply (op) {
    return this.applyMany([op])
  }

  applyMany (operations) {
    const opsToSend = []
    for (let i = 0; i < operations.length; i++) {
      const op = operations[i]
      const opToSend = this.replica.applyLocal(op)
      const opId = opIdToString(opToSend.opId)
      this.appliedOperationIds.add(opId)
      opsToSend.push(opToSend)
    }
    return this.sendOperations(opsToSend)
  }

  applyRemoteOperations (operations) {
    operations = operations.map((op) => deserializeOperation(new Buffer(op, 'base64')))

    for (let i = 0; i < operations.length; i++) {
      const op = operations[i]
      const opId = opIdToString(op.opId)
      if (!this.appliedOperationIds.has(opId)) {
        const opsToApply = this.replica.applyRemote(operations[i])
        this.appliedOperationIds.add(opId)
        this.delegate.applyMany(opsToApply)
      }
    }
  }

  async sendOperations (operations) {
    if (this.queuedOutboundOperations) {
      this.queuedOutboundOperations.push(...operations)
    } else {
      this.queuedOutboundOperations = []
      await this.restGateway.post(
        `/shared-buffers/${this.id}/operations`,
        {
          messageId: opIdToString(operations[0].opId),
          operations: operations.map((op) => new Buffer(serializeOperation(op)).toString('base64'))
        }
      )
      let queuedOutboundOperations = this.queuedOutboundOperations
      this.queuedOutboundOperations = null
      if (queuedOutboundOperations.length > 0) await this.sendOperations(queuedOutboundOperations)
    }
  }
}

function opIdToString (opId) {
  return `${opId.site}.${opId.seq}`
}
