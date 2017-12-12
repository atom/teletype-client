const {CompositeDisposable, Emitter} = require('event-kit')
const {RouterMessage} = require('./teletype-client_pb')
const convertToProtobufCompatibleBuffer = require('./convert-to-protobuf-compatible-buffer')

module.exports =
class Router {
  constructor (network) {
    this.network = network
    this.emitter = new Emitter()
    this.subscriptions = new CompositeDisposable()
    this.subscriptions.add(network.onReceive(this.receive.bind(this)))
    this.nextRequestId = 0
    this.requestPromiseResolveCallbacks = new Map()
    this.peerIdsByRequestId = new Map()
    this.lastReceivePromise = Promise.resolve()
  }

  dispose () {
    this.subscriptions.dispose()
  }

  notify ({recipientId, channelId, body}) {
    body = convertToProtobufCompatibleBuffer(body)

    const notification = new RouterMessage.Notification()
    notification.setChannelId(channelId)
    if (body != null) notification.setBody(body)
    const routerMessage = new RouterMessage()
    routerMessage.setNotification(notification)

    if (recipientId) {
      this.network.unicast(recipientId, routerMessage.serializeBinary())
    } else {
      this.network.broadcast(routerMessage.serializeBinary())
    }
  }

  request ({recipientId, channelId, body}) {
    if (body) body = convertToProtobufCompatibleBuffer(body)

    const requestId = this.nextRequestId++
    const request = new RouterMessage.Request()

    request.setChannelId(channelId)
    request.setRequestId(requestId)
    if (body) request.setBody(body)
    const routerMessage = new RouterMessage()
    routerMessage.setRequest(request)

    this.network.unicast(recipientId, routerMessage.serializeBinary())

    return new Promise((resolve) => {
      this.requestPromiseResolveCallbacks.set(requestId, resolve)
    })
  }

  respond ({requestId, ok, body}) {
    const recipientId = this.peerIdsByRequestId.get(requestId)
    if (!recipientId) throw new Error('Multiple responses to the same request are not allowed')

    if (ok == null) ok = true
    if (body) body = convertToProtobufCompatibleBuffer(body)

    const response = new RouterMessage.Response()
    response.setRequestId(requestId)
    response.setOk(ok)
    response.setBody(body)
    const routerMessage = new RouterMessage()
    routerMessage.setResponse(response)

    this.peerIdsByRequestId.delete(requestId)

    this.network.unicast(recipientId, routerMessage.serializeBinary())
  }

  onNotification (channelId, callback) {
    return this.emitter.on('notification:' + channelId, callback)
  }

  onRequest (channelId, callback) {
    return this.emitter.on('request:' + channelId, callback)
  }

  receive ({senderId, message}) {
    const routerMessage = RouterMessage.deserializeBinary(message)

    if (routerMessage.hasNotification()) {
      this.receiveNotification(senderId, routerMessage.getNotification())
    } else if (routerMessage.hasRequest()) {
      this.receiveRequest(senderId, routerMessage.getRequest())
    } else if (routerMessage.hasResponse()) {
      this.receiveResponse(routerMessage.getResponse())
    } else {
      throw new Error('Unsupported router message variant')
    }
  }

  receiveNotification (senderId, notification) {
    this.lastReceivePromise = this.lastReceivePromise.then(async () => {
      const channelId = notification.getChannelId()
      const body = convertToProtobufCompatibleBuffer(notification.getBody())
      await this.emitter.emitAsync(
        'notification:' + channelId,
        {senderId, body}
      )
    })
  }

  receiveRequest (senderId, request) {
    this.lastReceivePromise = this.lastReceivePromise.then(async () => {
      const channelId = request.getChannelId()
      const requestId = request.getRequestId()
      const eventName = 'request:' + channelId
      const body = convertToProtobufCompatibleBuffer(request.getBody())
      this.peerIdsByRequestId.set(requestId, senderId)

      if (this.emitter.listenerCountForEventName(eventName) === 0) {
        this.respond({requestId, ok: false})
      } else {
        await this.emitter.emitAsync(eventName, {senderId, requestId, body})
      }
    })
  }

  receiveResponse (response) {
    const requestId = response.getRequestId()
    const requestResolveCallback = this.requestPromiseResolveCallbacks.get(requestId)
    requestResolveCallback({
      body: convertToProtobufCompatibleBuffer(response.getBody()),
      ok: response.getOk()
    })
  }
}
