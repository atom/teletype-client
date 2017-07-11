const Pusher = require('pusher-js')

module.exports =
class PusherPubSubGateway {
  constructor ({key}) {
    this.pusherClient = new Pusher(key, {encrypted: true})
    this.channelsByName = new Map()
  }

  getClientId () {
    const socketId = this.pusherClient.connection.socket_id
    if (socketId) {
      return Promise.resolve(socketId)
    } else {
      return new Promise((resolve) => {
        this.pusherClient.connection.bind('connected', () => {
          resolve(this.pusherClient.connection.socket_id)
        })
      })
    }
  }

  subscribe (channelName, eventName, callback) {
    channelName = channelName.replace(/\//g, '.')
    let channel = this.channelsByName.get(channelName)
    if (!channel) {
      channel = this.pusherClient.subscribe(channelName)
      this.channelsByName.set(channelName, channel)
      channel.bind(eventName, callback)
      return new Promise((resolve) => {
        const subscriptionSucceededCallback = () => {
          channel.unbind('pusher:subscription_succeeded', subscriptionSucceededCallback)
          resolve({
            dispose () {
              channel.unbind(eventName, callback)
            }
          })
        }
        channel.bind('pusher:subscription_succeeded', subscriptionSucceededCallback)
      })
    } else {
      channel.bind(eventName, callback)
      return Promise.resolve({
        dispose () {
          channel.unbind(eventName, callback)
        }
      })
    }
  }
}
