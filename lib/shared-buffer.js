const assert = require('assert')
const {
  DocumentReplica, serializeOperation, deserializeOperation
} = require('@atom/tachyon')
const FragmentInbox = require('./fragment-inbox')

module.exports =
class SharedBuffer {
  constructor ({restGateway, pubSubGateway, taskQueue, delegate, siteId, id, replica, uri}) {
    this.restGateway = restGateway
    this.pubSubGateway = pubSubGateway
    this.taskQueue = taskQueue
    this.delegate = delegate
    this.id = id
    this.siteId = siteId
    this.uri = uri
    this.replica = replica
    this.deferredOperations = []
    this.appliedOperationIds = new Set()
    this.incomingMessageEnvelopesById = new Map()
    this.inbox = new FragmentInbox()
  }

  async dispose () {
    if (this.subscription) await this.subscription.dispose()
  }

  async create ({uri, text}) {
    this.uri = uri
    this.replica = new DocumentReplica(this.siteId)
    const operation = this.replica.insertLocal({position: 0, text})
    const {id} = await this.restGateway.post(
      '/shared-buffers',
      {
        uri,
        operations: [new Buffer(serializeOperation(operation)).toString('base64')]
      }
    )
    this.id = id
    await this.subscribe()
  }

  async join () {
    await this.subscribe()
    const {uri, operations} = await this.restGateway.get(`/shared-buffers/${this.id}`)
    this.uri = uri
    this.replica = new DocumentReplica(this.siteId)
    this.applyRemoteOperations(operations)
    this.applyRemoteOperations(this.deferredOperations)
    this.deferredOperations = null
  }

  setDelegate (delegate) {
    assert(this.siteId, 'You must either create or join a SharedBuffer before setting the delegate')
    this.delegate = delegate
    if (this.siteId !== 1) this.delegate.setText(this.replica.getText())
  }

  async subscribe () {
    this.subscription = await this.pubSubGateway.subscribe(
      `/shared-buffers/${this.id}`,
      'operations',
      this.receiveOperations.bind(this)
    )
  }

  receiveOperations (envelope) {
    const operations = this.inbox.receive(envelope)
    if (operations) {
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

    this.taskQueue.push({
      id: `/shared-buffers/${this.id}/operations`,
      data: opsToSend,
      coalesce: this.coalesceOperations,
      execute: this.sendOperations.bind(this)
    })
  }

  applyRemoteOperations (operations) {
    operations = operations.map((op) => deserializeOperation(new Buffer(op, 'base64')))

    for (let i = 0; i < operations.length; i++) {
      const op = operations[i]
      const opId = opIdToString(op.opId)
      if (!this.appliedOperationIds.has(opId)) {
        const opsToApply = this.replica.applyRemote(operations[i])
        this.appliedOperationIds.add(opId)
        if (this.delegate) this.delegate.applyMany(opsToApply)
      }
    }
  }

  // Private
  coalesceOperations (operations) {
    const coalescedOperations = []
    for (let i = 0; i < operations.length; i++) {
      coalescedOperations.push(...operations[i])
    }
    return coalescedOperations
  }

  // Private
  sendOperations (operations) {
    return this.restGateway.post(
      `/shared-buffers/${this.id}/operations`,
      {
        messageId: opIdToString(operations[0].opId),
        operations: operations.map((op) => new Buffer(serializeOperation(op)).toString('base64'))
      }
    )
  }
}

function opIdToString (opId) {
  return `${opId.site}.${opId.seq}`
}
