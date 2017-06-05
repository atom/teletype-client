const Pusher = require('pusher-js')

module.exports =
class PusherPubSubGateway {
  constructor ({key}) {
    this.pusherClient = new Pusher(key, {encrypted: true})
  }

  subscribe (channelName, eventName, callback) {
    channelName = channelName.replace(/\//g, '.')
    const channel = this.pusherClient.subscribe(channelName)
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
  }
}
